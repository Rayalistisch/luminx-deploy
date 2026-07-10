/**
 * The contract every CMS speaks (docs/architecture.md §7.1).
 *
 * The adapter executes operations the core decided on. It never decides on one itself — that is
 * what keeps `--dry-run` honest: the plan you are shown is exactly the plan that runs.
 */

import type {
  CurrentModel,
  FieldType,
  HealthCheck,
  LogicalId,
  LuminxError,
  Operation,
  OperationResult,
  ProjectFacts,
  ResourceKind,
  Result,
  SnapshotRef,
} from '@luminx/shared';

/**
 * What an adapter can express. Checked against the compiled model *before* a plan exists, so a
 * config using a field type this CMS lacks is a validation error rather than a crash halfway
 * through an apply.
 */
export interface Capabilities {
  readonly fieldTypes: readonly FieldType[];
  readonly resourceKinds: readonly ResourceKind[];
}

export interface CmsInfo {
  /** Version of the CMS itself, as the far side reports it. */
  readonly version: string;
  /** Free-form: runtime version, plugin version, whatever the adapter learned while detecting. */
  readonly diagnostics: Readonly<Record<string, string>>;
}

export interface AdapterContext {
  readonly root: string;
  readonly facts: ProjectFacts;
}

export interface ApplyContext extends AdapterContext {
  /**
   * UIDs resolved so far, by logicalId. Phase 2 wires references with these: it is how one
   * resource learns another's UID without any generator calling another generator (§9.2).
   */
  readonly resolved: ReadonlyMap<LogicalId, string>;
}

export interface CmsAdapter {
  readonly id: string;
  readonly protocolVersion: number;
  readonly capabilities: Capabilities;

  /** Is this CMS present in the project, and at which version? */
  readonly detect: (context: AdapterContext) => Promise<Result<CmsInfo, LuminxError>>;

  /** Reads the current state and normalises it to the IR. Free of side effects. */
  readonly introspect: (context: AdapterContext) => Promise<Result<CurrentModel, LuminxError>>;

  /** Executes one operation. Must be idempotent. Returns the resulting UID. */
  readonly apply: (
    operation: Operation,
    context: ApplyContext,
  ) => Promise<Result<OperationResult, LuminxError>>;

  /** Taken before the first write, so `undo` has somewhere to go back to (§10). */
  readonly snapshot: (context: AdapterContext) => Promise<Result<SnapshotRef, LuminxError>>;
  readonly restore: (
    ref: SnapshotRef,
    context: AdapterContext,
  ) => Promise<Result<void, LuminxError>>;

  /**
   * Optional: `undo --list`. Not every CMS can enumerate its snapshots, and a required method
   * that half the adapters throw from is worse than an optional one they omit.
   */
  readonly listSnapshots?: (
    context: AdapterContext,
  ) => Promise<Result<readonly SnapshotRef[], LuminxError>>;

  /** CMS-specific doctor checks, on top of the generic ones. */
  readonly healthChecks: (context: AdapterContext) => Promise<readonly HealthCheck[]>;
}
