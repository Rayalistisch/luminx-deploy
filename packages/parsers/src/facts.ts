/**
 * Everything LuminX can learn about a project by reading files, in one plain-data object.
 *
 * **This type names no CMS, and it must not start.** The adapter contract in `core` takes
 * `ProjectFacts` (§7.1), yet `core` may depend only on `shared` (§4) — so this type belongs in
 * `shared` the moment that contract exists, and `shared` is the package `check:purity` guards
 * most strictly.
 *
 * A `craftVersion` field would make that move impossible. So the facts stay neutral: this
 * package reports which Composer packages are installed, and `adapter-craft` is what knows
 * that `craftcms/cms` is the one worth caring about. Which is exactly where that knowledge
 * belongs — the parsers see packages, the adapter sees a CMS.
 */

import type { Framework } from './frontend.js';
import type { RunnerId } from './runner.js';

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
  /** Exact versions from `composer.lock`. Empty unless `lock` is `parsed`. */
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
