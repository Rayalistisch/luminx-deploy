/**
 * `luminx plan` — compute the plan as a reviewable artefact (docs/architecture.md §8.4, §11).
 *
 * `generate --dry-run` shows a plan and forgets it. `plan` writes it to a file, so it can be
 * committed to a pull request, read by a human, and — once `deploy` exists — applied unchanged on
 * another environment. That plan/apply split is Terraform's, and it is the reason the plan has
 * been a serialisable value with a `sourceHash` and a `baseHash` since M5 rather than something
 * this command had to invent (§11.2).
 *
 * It is pure: it reads and writes a file, never the CMS. It is `generate --dry-run` made durable.
 */

import { writeFile } from 'node:fs/promises';

import { summarize } from '@luminx/shared';

import { ExitCode } from '../exit.js';
import type { Io } from '../io.js';
import { paint, renderJson, renderPlan } from '../render.js';
import { buildPlan, fail } from './pipeline.js';
import type { PipelineOptions } from './pipeline.js';

export interface PlanOptions extends PipelineOptions {
  /** Where to write the plan. `--json` without this streams it to stdout instead. */
  readonly out: string | undefined;
}

export const runPlan = async (io: Io, options: PlanOptions): Promise<ExitCode> => {
  const result = await buildPlan(io, options);
  if ('errors' in result) return fail(io, result.errors, options.json);

  const { plan } = result;

  // A plan on stdout is a pipe into something else; a plan in a file is an artefact to review.
  if (options.out === undefined) {
    if (options.json) io.stdout(renderJson(plan));
    else io.stdout(renderPlan(io.color, plan));
    return ExitCode.Success;
  }

  await writeFile(options.out, renderJson(plan), 'utf8');

  const counts = summarize(plan);
  io.stdout(
    `${paint(io.color, 'green', '✔')} Wrote ${options.out}\n` +
      `  ${counts.total} operations   sourceHash ${plan.sourceHash.slice(0, 14)}…   ` +
      `baseHash ${plan.baseHash.slice(0, 14)}…\n` +
      `  Review it, then apply it with ${paint(io.color, 'bold', 'luminx deploy')} (planned for 1.x).\n`,
  );

  return ExitCode.Success;
};
