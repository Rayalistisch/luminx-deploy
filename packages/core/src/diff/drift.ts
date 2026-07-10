/**
 * Drift: the CMS was changed out from under LuminX (docs/architecture.md §5.3).
 *
 * The differ already says what `generate` would do. Drift answers a different question — *why* a
 * resource differs — and only the lockfile can tell them apart:
 *
 *   config hash == lockfile hash   the config has not changed since the last apply
 *   current hash != lockfile hash  the CMS has
 *
 * Both at once means someone edited the control panel. `generate` would quietly overwrite it;
 * `sync` reports it first, because silently undoing a colleague's afternoon is not reconciliation.
 *
 * A resource whose config *also* changed is not drift — it is an ordinary update, and the differ
 * already has it. Drift is specifically the change LuminX did not ask for.
 */

import type { CurrentModel, LogicalId, ResourceKind } from '@luminx/shared';

import type { CompiledModel } from '../config/compiler.js';
import type { Lockfile } from '../state/lockfile.js';

export interface Drift {
  readonly logicalId: LogicalId;
  readonly kind: ResourceKind;
  readonly handle: string;
}

export const detectDrift = (
  desired: CompiledModel,
  current: CurrentModel,
  lockfile: Lockfile | null,
): readonly Drift[] => {
  if (lockfile === null) return [];

  const drift: Drift[] = [];

  for (const [logicalId, entry] of Object.entries(lockfile.resources)) {
    const want = desired.model.resources.get(logicalId);
    const have = current.resources.get(logicalId);

    // Gone from the config, or gone from the CMS: that is an orphan or a missing resource, which
    // the plan already reports. Drift is only about a resource that still exists on both sides.
    if (want === undefined || have === undefined) continue;

    const configUnchanged = want.hash === entry.hash;
    const cmsChanged = have.resource.hash !== entry.hash;

    if (configUnchanged && cmsChanged) {
      drift.push({ logicalId, kind: want.kind, handle: want.handle });
    }
  }

  // Sorted, so `sync` reports drift in the same order every run (§13).
  return drift.sort((a, b) => (a.logicalId < b.logicalId ? -1 : 1));
};
