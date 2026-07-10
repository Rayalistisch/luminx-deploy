/**
 * `luminx sync` — reconcile config and CMS, and show what diverged (§8.4).
 *
 * `generate` is additive: bring the CMS up to the config. `sync` is reconciling: show the drift,
 * offer to prune what the config no longer describes, and — under `--check` — fail a pipeline
 * when the two have grown apart at all. Same pipeline as `generate` (§15 decision 4); different
 * attitude.
 *
 *   --check   exit 1 if anything would change. No prompts, no writes. For CI.
 *   --prune   delete resources the CMS has and the config does not (§8.2). Confirmed per run.
 */

import { detectDrift, execute, writeLockfile } from '@luminx/core';
import { isNoop, summarize } from '@luminx/shared';

import { ExitCode, exitCodeFor } from '../exit.js';
import type { Io } from '../io.js';
import { paint, renderErrors, renderJson, renderPlan } from '../render.js';
import { buildPlan, fail } from './pipeline.js';
import type { PipelineOptions } from './pipeline.js';

export interface SyncOptions extends PipelineOptions {
  /** CI mode: exit 1 if the CMS and the config would diverge. Never writes, never prompts. */
  readonly check: boolean;
}

export const runSync = async (io: Io, options: SyncOptions): Promise<ExitCode> => {
  const result = await buildPlan(io, options);
  if ('errors' in result) return fail(io, result.errors, options.json);

  const { plan, adapter, context, current, desired, lockfile } = result;
  const drift = detectDrift(desired, current, lockfile);

  if (options.json) {
    io.stdout(renderJson({ plan, drift }));
  } else {
    io.stdout(renderPlan(io.color, plan));

    // Drift is reported, never silently reconciled: someone changed the CMS by hand, and they
    // deserve to know LuminX noticed before it writes over them (§5.3).
    if (drift.length > 0) {
      io.stdout(
        `\n  ${paint(io.color, 'yellow', 'Drift')} — changed in the CMS since the last apply, not in the config:\n`,
      );
      for (const entry of drift) {
        io.stdout(`    ${entry.kind.padEnd(11)} ${entry.handle}\n`);
      }
      io.stdout(
        `  ${paint(io.color, 'dim', 'generate or sync will restore these to the config.')}\n`,
      );
    }
  }

  const counts = summarize(plan);

  // --check is the pipeline gate: config and CMS must be identical, or exit 1 — a signal to act,
  // not a failure (§8.6). Drift counts as divergence even when the plan itself is a noop, because
  // a hand-edited CP is exactly what a pipeline is meant to catch.
  if (options.check) {
    const diverged = !isNoop(plan) || drift.length > 0;

    if (!options.json) {
      io.stdout(
        diverged
          ? `\n  ${paint(io.color, 'yellow', '!')} The CMS and the config have diverged.\n`
          : `\n  ${paint(io.color, 'green', '✔')} The CMS matches the config.\n`,
      );
    }
    return diverged ? ExitCode.ChangesDetected : ExitCode.Success;
  }

  if (isNoop(plan)) {
    if (!options.json) io.stdout(`\n  Nothing to do.\n`);
    return ExitCode.Success;
  }

  // A prune deletes content-bearing resources, so it is confirmed out loud and says what it means.
  if (counts.delete > 0) {
    io.stdout(
      `\n  ${paint(io.color, 'yellow', '!')} ${counts.delete} resource(s) will be deleted. ` +
        `Their content goes with them, and undo brings the model back empty (§10).\n`,
    );
  }

  if (!(await io.confirm('\n  Apply these changes?'))) {
    io.stdout('  Cancelled. Nothing was written.\n');
    return ExitCode.Success;
  }

  const report = await execute({
    plan,
    adapter,
    context,
    current,
    ...(options.json
      ? {}
      : {
          onOperation: (operation, applied) =>
            io.stdout(
              `  ${paint(io.color, 'dim', applied.status.padEnd(8))} ${operation.resource.logicalId}\n`,
            ),
        }),
  });

  await writeLockfile(options.lockfilePath, report.lockfile);

  if (report.failure !== undefined) {
    io.stderr(`\n${renderErrors(io.color, [report.failure])}`);
    if (report.snapshot !== null) {
      io.stderr(
        `  ${report.results.length} operation(s) were applied before it stopped.\n` +
          `  Restore the snapshot with ${paint(io.color, 'bold', 'luminx undo')}.\n`,
      );
    }
    return exitCodeFor(report.failure);
  }

  io.stdout(`\n  ${paint(io.color, 'green', '✔')} Applied ${report.results.length} operations.\n`);
  io.stdout(`  Wrote ${options.lockfilePath}\n`);

  return ExitCode.Success;
};
