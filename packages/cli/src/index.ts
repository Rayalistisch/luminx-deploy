/**
 * luminx — the CLI. This is the composition root: the only place where adapters are
 * registered and dependencies are wired. Nothing imports this package.
 *
 * Commands land in M3. See docs/architecture.md §3.5 and §8.
 */

/** Process exit codes. See docs/architecture.md §8.6. */
export const ExitCode = {
  Success: 0,
  ChangesDetected: 1,
  ConfigError: 2,
  EnvironmentError: 3,
  ApplyFailed: 4,
  InternalError: 5,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
