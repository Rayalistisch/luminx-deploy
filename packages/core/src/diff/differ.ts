/**
 * Desired × current × lockfile → Plan (docs/architecture.md §8).
 *
 * Pure. No I/O, no adapter, no clock. Feed it two models and it yields the same plan every time,
 * which is what makes `--dry-run` a promise rather than a preview.
 *
 * Each resource yields at most two operations, one per phase (§8.3):
 *
 *   new, no wiring        create(1)
 *   new, with wiring      create(1) then create(2)
 *   changed structure     update(1)
 *   changed wiring        update(2)
 *   unchanged             skip
 *
 * A resource that is unchanged emits nothing in phase 2 even though it has references. That is
 * the whole of idempotency: a second `generate` must report skips and nothing else.
 */

import { ErrorCode, err, luminxError, ok } from '@luminx/shared';
import type {
  CurrentModel,
  FieldChange,
  LogicalId,
  LuminxError,
  Operation,
  OrphanedResource,
  Plan,
  Resource,
  Result,
} from '@luminx/shared';

import type { CompiledModel } from '../config/compiler.js';
import { hashOf } from '../hash.js';
import { topologicalOrder } from '../plan/orderer.js';
import { hasWiring, isWiringPath } from '../plan/phases.js';
import type { Lockfile } from '../state/lockfile.js';
import { diffValues } from './changes.js';

export interface DiffInput {
  readonly desired: CompiledModel;
  readonly current: CurrentModel;
  readonly lockfile: Lockfile | null;
  /** Deletes are produced only under `--prune`. Leaving a resource out never removes it (§8.2). */
  readonly prune?: boolean;
}

/** Everything that identifies a resource to the CMS, plus its settings. Not `dependsOn`: derived. */
const comparable = (resource: Resource) => ({
  handle: resource.handle,
  name: resource.name,
  spec: resource.spec,
});

/**
 * Resolves `previousHandle` to the resource the CMS still has under the old identity.
 *
 * The lockfile is consulted but not required: §5.3 says a lost lockfile is rebuildable from
 * introspection, so a rename must still work when the CMS has the old resource and the lockfile
 * does not. What cannot work is renaming something the CMS has never heard of.
 */
const resolveRenames = (
  desired: CompiledModel,
  current: CurrentModel,
  errors: LuminxError[],
): ReadonlyMap<LogicalId, LogicalId> => {
  const sources = new Map<LogicalId, LogicalId>();

  for (const [newId, oldId] of desired.renames) {
    if (current.resources.has(newId)) continue; // Already applied; the hint is now a no-op.

    if (!current.resources.has(oldId)) {
      const [, previousHandle] = oldId.split(':');
      errors.push(
        luminxError(
          ErrorCode.ConfigUnknownPreviousHandle,
          `previousHandle "${previousHandle}" names something the CMS does not have`,
          {
            logicalId: newId,
            hint: 'Remove previousHandle: there is nothing to rename, and LuminX will create it.',
          },
        ),
      );
      continue;
    }

    sources.set(newId, oldId);
  }

  return sources;
};

const operationsFor = (
  desired: Resource,
  current: CurrentModel,
  sourceId: LogicalId,
): readonly Operation[] => {
  const existing = current.resources.get(sourceId);

  if (existing === undefined) {
    return hasWiring(desired)
      ? [
          { kind: 'create', resource: desired, phase: 1 },
          { kind: 'create', resource: desired, phase: 2 },
        ]
      : [{ kind: 'create', resource: desired, phase: 1 }];
  }

  const changes = diffValues(comparable(existing.resource), comparable(desired));
  if (changes.length === 0) return [{ kind: 'skip', resource: desired, reason: 'unchanged' }];

  const structure: FieldChange[] = [];
  const wiring: FieldChange[] = [];
  for (const change of changes) {
    (isWiringPath(desired, change.path) ? wiring : structure).push(change);
  }

  const operations: Operation[] = [];
  if (structure.length > 0) {
    operations.push({
      kind: 'update',
      resource: desired,
      uid: existing.uid,
      changes: structure,
      phase: 1,
    });
  }
  if (wiring.length > 0) {
    operations.push({
      kind: 'update',
      resource: desired,
      uid: existing.uid,
      changes: wiring,
      phase: 2,
    });
  }
  return operations;
};

export const diff = (input: DiffInput): Result<Plan, readonly LuminxError[]> => {
  const { desired, current, prune = false } = input;
  const errors: LuminxError[] = [];

  const renameSources = resolveRenames(desired, current, errors);
  if (errors.length > 0) return err(errors);

  const operations: Operation[] = [];
  const claimed = new Set<LogicalId>();

  // Ordered by dependency, not by the order the config happened to mention things.
  for (const resource of topologicalOrder([...desired.model.resources.values()])) {
    const sourceId = renameSources.get(resource.logicalId) ?? resource.logicalId;
    claimed.add(sourceId);
    operations.push(...operationsFor(resource, current, sourceId));
  }

  const orphaned: OrphanedResource[] = [...current.resources.entries()]
    .filter(([id]) => !claimed.has(id))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, { resource, uid }]) => ({
      logicalId: id,
      kind: resource.kind,
      handle: resource.handle,
      uid,
    }));

  const deletes: Operation[] = prune
    ? // Reverse dependency order: nothing is removed before the things that point at it.
      topologicalOrder(
        orphaned.flatMap((entry) => current.resources.get(entry.logicalId)?.resource ?? []),
      )
        .slice()
        .reverse()
        .map((resource) => ({
          kind: 'delete',
          resource,
          uid: current.resources.get(resource.logicalId)?.uid ?? '',
        }))
    : [];

  const phase = (want: 1 | 2) =>
    operations.filter((operation) => 'phase' in operation && operation.phase === want);

  const skips = operations.filter((operation) => operation.kind === 'skip');

  const baseHash = hashOf(
    [...current.resources.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, { resource }]) => [id, resource.hash]),
  );

  return ok({
    version: 1,
    cms: desired.cms,
    sourceHash: desired.sourceHash,
    baseHash,
    operations: [...phase(1), ...phase(2), ...skips, ...deletes],
    orphaned,
  });
};
