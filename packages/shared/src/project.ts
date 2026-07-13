/**
 * What LuminX can learn about a project by reading files. Part of the adapter contract:
 * `CmsAdapter.detect` receives these (§7.1), and the contract lives in `core`, which may
 * depend only on this package (§4).
 *
 * **Names no CMS, and must not start.** `check:purity` guards this package hardest, and for
 * good reason: the moment a `craftVersion` field appears here, every adapter that is not for
 * that CMS inherits a field it cannot fill. The parsers report which Composer packages are
 * installed; which of them constitutes "the CMS" is a question only an adapter can answer.
 */

/**
 * `ssh` is reserved for `deploy` (§7.3, §11.2). It is never auto-detected — like `local`, it is
 * only ever chosen — and its runner is a stub until deploy ships. Reserving the id here, in the
 * milestone that prepares deploy (§14, M12), is not the empty name it would have been earlier:
 * it is the seam deploy plugs into, declared where every other runner id already lives.
 */
export const RUNNERS = ['ddev', 'lando', 'docker', 'local', 'ssh'] as const;

export type RunnerId = (typeof RUNNERS)[number];

export const FRAMEWORK_IDS = ['next', 'nuxt', 'astro', 'sveltekit', 'remix'] as const;

export type FrameworkId = (typeof FRAMEWORK_IDS)[number];

export interface Framework {
  readonly id: FrameworkId;
  /** The declared range, verbatim: `^15.0.0`. Not a resolved version — package.json has none. */
  readonly constraint: string;
}

/**
 * Three states, not a boolean.
 *
 * `absent` means the project was never installed — a warning. `unreadable` means there is a
 * lock file and it is corrupt — a failure, and a different one. Collapsing them into
 * `locked: false` would tell doctor that a broken lock file is a fresh checkout.
 */
export type LockState = 'absent' | 'unreadable' | 'parsed';

export interface ComposerFacts {
  readonly name: string | null;
  /** The `php` constraint the project asks for, e.g. `^8.3`. A wish, not an installed version. */
  readonly phpConstraint: string | null;
  readonly require: Readonly<Record<string, string>>;
  /** Exact versions from the lock file. Empty unless `lock` is `parsed`. */
  readonly installed: Readonly<Record<string, string>>;
  readonly lock: LockState;
}

export interface ProjectFacts {
  readonly root: string;
  /** Null when there is no `composer.json`, or it could not be parsed. */
  readonly composer: ComposerFacts | null;
  /** Every frontend framework declared. More than one is possible; none is common. */
  readonly frameworks: readonly Framework[];
  /** Runners whose marker files exist, most specific first. */
  readonly detectedRunners: readonly RunnerId[];
  /** What auto-detection settles on. `--runner` overrides it. */
  readonly runner: RunnerId;
  /** Keys defined in `.env`. Never the values. Null when there is no `.env`. */
  readonly envKeys: readonly string[] | null;
}
