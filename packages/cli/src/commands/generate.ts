/**
 * `luminx generate` — bring the CMS up to date with the config (§8.4).
 *
 * The eight steps of §8.1 run in order, and steps 1–6 are pure: load, validate, probe, compile,
 * introspect, diff. Only step 8 writes, and it writes nothing without a snapshot and a yes.
 */

import { execute, writeLockfile } from '@luminx/core';
import { isNoop } from '@luminx/shared';

import { ExitCode, exitCodeFor } from '../exit.js';
import type { Io } from '../io.js';
import { paint, renderErrors, renderJson, renderPlan } from '../render.js';
import { buildPlan, fail } from './pipeline.js';
import type { PipelineOptions } from './pipeline.js';

export type { RegistryFactory } from './pipeline.js';

export interface GenerateOptions extends PipelineOptions {
  readonly dryRun: boolean;
}

export const runGenerate = async (io: Io, options: GenerateOptions): Promise<ExitCode> => {
  const result = await buildPlan(io, options);
  if ('errors' in result) return fail(io, result.errors, options.json);

  const { plan, adapter, context, current } = result;

  if (options.json) io.stdout(renderJson(plan));
  else io.stdout(renderPlan(io.color, plan));

  if (options.dryRun) return ExitCode.Success;

  if (isNoop(plan)) {
    if (!options.json) io.stdout(`\n  Nothing to do.\n`);
    return ExitCode.Success;
  }

  // Silence never writes. `--yes` is the only way past this in CI (§8.5).
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

  // The lockfile records what happened, so it is written even when the run stopped early.
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
