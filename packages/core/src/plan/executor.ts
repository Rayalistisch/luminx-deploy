/**
 * Executing a plan (docs/architecture.md §8.1 step 8, §10).
 *
 * The only place in `core` that causes a write. Everything before it — load, validate, probe,
 * compile, introspect, diff — is pure, which is what makes `--dry-run` a promise.
 *
 * A snapshot is taken **before the first write**, not after the last. If the process dies between
 * two operations there is still something to go back to. That is the whole reason M8 ships `undo`
 * in the same milestone as the first apply, rather than in the one after.
 *
 * On the first failure it stops. A CMS need not be globally transactional (§9.5), so the
 * operations that already ran stay applied; the report says which, and `undo` restores the
 * snapshot.
 */

import { ErrorCode, luminxError } from '@luminx/shared';
import type {
  CurrentModel,
  LogicalId,
  LuminxError,
  Operation,
  OperationResult,
  Plan,
  SnapshotRef,
} from '@luminx/shared';

import type { AdapterContext, CmsAdapter } from '../adapter/contract.js';
import { emptyLockfile } from '../state/lockfile.js';
import type { LockEntry, Lockfile } from '../state/lockfile.js';

export interface ExecuteInput {
  readonly plan: Plan;
  readonly adapter: CmsAdapter;
  readonly context: AdapterContext;
  /** What the CMS held when the plan was made. Supplies the UID of anything left untouched. */
  readonly current: CurrentModel;
  readonly onOperation?: (operation: Operation, result: OperationResult) => void;
}

export interface ExecutionReport {
  readonly results: readonly OperationResult[];
  /** Taken before the first write. Null when the plan had nothing to write. */
  readonly snapshot: SnapshotRef | null;
  /** Rebuilt from what actually happened, never from what was planned. */
  readonly lockfile: Lockfile;
  /** Present when execution stopped early. `results` holds what ran before it. */
  readonly failure?: LuminxError;
}

const writes = (operation: Operation): boolean => operation.kind !== 'skip';

/**
 * A lockfile is a record of the CMS as it now is, so it is built from operation results — not
 * from the plan. A plan that half-applied must leave a lockfile describing the half that did.
 */
const lockfileFrom = (
  cms: string,
  plan: Plan,
  resolved: ReadonlyMap<LogicalId, string>,
): Lockfile => {
  const resources: Record<LogicalId, LockEntry> = {};
  const deleted = new Set(
    plan.operations
      .filter((operation) => operation.kind === 'delete')
      .map((operation) => operation.resource.logicalId),
  );

  for (const operation of plan.operations) {
    const { logicalId, hash } = operation.resource;
    const uid = resolved.get(logicalId);

    if (uid === undefined || deleted.has(logicalId)) continue;
    resources[logicalId] = { uid, hash };
  }

  return { ...emptyLockfile(cms), resources };
};

export const execute = async (input: ExecuteInput): Promise<ExecutionReport> => {
  const { plan, adapter, context, current } = input;

  // Whatever already exists keeps its UID, so phase 2 can wire a reference to a resource this
  // run never touched.
  const resolved = new Map<LogicalId, string>(
    [...current.resources].map(([id, entry]) => [id, entry.uid]),
  );

  const results: OperationResult[] = [];

  if (!plan.operations.some(writes)) {
    return { results, snapshot: null, lockfile: lockfileFrom(plan.cms, plan, resolved) };
  }

  const snapshot = await adapter.snapshot(context);

  if (!snapshot.ok) {
    // Refusing to write is the right answer. A write with no way back is the one thing §10 exists
    // to prevent, and a snapshot that failed is not a snapshot.
    return {
      results,
      snapshot: null,
      lockfile: lockfileFrom(plan.cms, plan, resolved),
      failure: snapshot.error,
    };
  }

  for (const operation of plan.operations) {
    const applied = await adapter.apply(operation, { ...context, resolved });

    if (!applied.ok) {
      return {
        results,
        snapshot: snapshot.value,
        lockfile: lockfileFrom(plan.cms, plan, resolved),
        failure: applied.error,
      };
    }

    if (applied.value.uid === '') {
      return {
        results,
        snapshot: snapshot.value,
        lockfile: lockfileFrom(plan.cms, plan, resolved),
        failure: luminxError(
          ErrorCode.InternalInvariantViolated,
          `The adapter applied ${operation.resource.logicalId} but returned no UID`,
        ),
      };
    }

    resolved.set(operation.resource.logicalId, applied.value.uid);
    results.push(applied.value);
    input.onOperation?.(operation, applied.value);
  }

  return { results, snapshot: snapshot.value, lockfile: lockfileFrom(plan.cms, plan, resolved) };
};
