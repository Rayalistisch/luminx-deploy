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
  /**
   * Handles the CMS keeps for itself, so a field named `title` or `id` fails at validation with a
   * pointer rather than halfway through an apply with half a layout written. The adapter owns the
   * list; an empty one means the CMS reserves nothing.
   */
  readonly reservedFieldHandles?: readonly string[];
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

/**
 * Standing a CMS up from nothing.
 *
 * Every other method here assumes the CMS exists. This one creates it, and it is the only place
 * where LuminX brings a project into being rather than reconciling one that already is.
 *
 * Deliberately thin, and deliberately neutral: the core knows a site has a name and an admin, and
 * nothing else. Everything a particular CMS needs to be born — a PHP version, a database engine,
 * where to find a plugin — travels in `options`, which the core carries and never reads. That is
 * the same escape hatch the IR's `raw` uses, for the same reason.
 */
export interface ScaffoldOptions {
  readonly root: string;
  readonly siteName: string;
  readonly siteUrl?: string;
  readonly admin: {
    readonly username: string;
    readonly email: string;
    readonly password: string;
  };
  /** Adapter-specific knobs. Opaque to the core (`php`, `database`, `pluginPath`, …). */
  readonly options?: Readonly<Record<string, string>>;
}

export interface ScaffoldContext {
  /** Scaffolding takes minutes. This is how the CLI shows it is alive. */
  readonly onStep?: (message: string) => void;
}

export interface ScaffoldResult {
  readonly root: string;
  readonly version: string;
  /** The URL the site is now reachable at, when the adapter can say. */
  readonly url?: string;
  /** What the user still has to do, or should know. Printed verbatim. */
  readonly notes: readonly string[];
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

  /**
   * Optional: `luminx new`. An adapter that cannot stand its CMS up from nothing simply omits
   * this, and the CLI says so rather than pretending. It is the one method that runs before the
   * CMS exists, so it takes no AdapterContext — there is no project to describe yet.
   */
  readonly scaffold?: (
    options: ScaffoldOptions,
    context: ScaffoldContext,
  ) => Promise<Result<ScaffoldResult, LuminxError>>;

  /**
   * Optional: `luminx content push`. Writes entries — the content, not the model.
   *
   * Every other method here reconciles: the config is the truth, and what diverges is corrected.
   * This one does not, and the asymmetry is the point. Content is written by people, and often
   * after it was pushed; a markdown file deleted from a repository must not take a published
   * article — or an editor's morning of work — with it. So this upserts, and never deletes.
   * Removing an entry stays a decision a human makes in the CMS.
   */
  readonly pushContent?: (
    entries: readonly ContentEntry[],
    context: AdapterContext,
  ) => Promise<Result<ContentReport, LuminxError>>;

  /** CMS-specific doctor checks, on top of the generic ones. */
  readonly healthChecks: (context: AdapterContext) => Promise<readonly HealthCheck[]>;
}

/** One entry to write. Matched on `slug` within `section` — the identifier a file and an entry share. */
export interface ContentEntry {
  readonly section: string;
  readonly entryType: string;
  readonly slug: string;
  readonly title: string;
  /** ISO 8601. The CMS decides how to store it. */
  readonly postDate?: string;
  /** Field handles to values. A matrix value is a list of `ContentBlock`. */
  readonly fields: Readonly<Record<string, unknown>>;
}

/** A matrix block: which entry type it is, and the fields it carries. */
export interface ContentBlock {
  readonly entryType: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface ContentReport {
  readonly written: readonly { slug: string; status: 'created' | 'updated'; id: number }[];
  readonly created: number;
  readonly updated: number;
}
