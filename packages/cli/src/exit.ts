/**
 * Exit codes (docs/architecture.md §8.6). The CLI is the only package that knows a process
 * exists: `shared` names what went wrong, and the mapping to a number happens here.
 */

import { ErrorCategory, categoryOf } from '@luminx/shared';
import type { LuminxError } from '@luminx/shared';

export const ExitCode = {
  Success: 0,
  /** `--check` / `--dry-run` found changes. Not a failure — a signal to act. */
  ChangesDetected: 1,
  ConfigError: 2,
  EnvironmentError: 3,
  /** A write failed. A snapshot exists; `luminx undo` is the way back. */
  ApplyFailed: 4,
  InternalError: 5,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

const BY_CATEGORY: Readonly<Record<ErrorCategory, ExitCode>> = {
  [ErrorCategory.Config]: ExitCode.ConfigError,
  [ErrorCategory.Environment]: ExitCode.EnvironmentError,
  // A version mismatch or an unreachable plugin is something about the machine, not the config.
  [ErrorCategory.Protocol]: ExitCode.EnvironmentError,
  [ErrorCategory.Apply]: ExitCode.ApplyFailed,
  [ErrorCategory.Internal]: ExitCode.InternalError,
};

export const exitCodeFor = (error: LuminxError): ExitCode => BY_CATEGORY[categoryOf(error.code)];

/** With many errors the most severe one decides, so a real failure is never masked by a lesser. */
export const exitCodeForAll = (errors: readonly LuminxError[]): ExitCode =>
  errors.reduce<ExitCode>(
    (worst, error) => (exitCodeFor(error) > worst ? exitCodeFor(error) : worst),
    ExitCode.Success,
  );
