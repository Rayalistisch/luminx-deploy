/**
 * luminx — the CLI. This is the composition root: the only place where adapters are
 * registered and dependencies are wired. Nothing imports this package.
 *
 * See docs/architecture.md §3.5 and §8.
 */

export { ExitCode, exitCodeFor, exitCodeForAll } from './exit.js';
export { UsageError, parseCli, registryFor, runCommand } from './cli.js';
export type { ParsedCli } from './cli.js';
export { createIo } from './io.js';
export type { Io, IoOptions } from './io.js';
export { collectChecks, runDoctor } from './commands/doctor.js';
export { runGenerate } from './commands/generate.js';
export { runInit } from './commands/init.js';
export { runPlan } from './commands/plan.js';
export { runSync } from './commands/sync.js';
export { runUndo } from './commands/undo.js';
