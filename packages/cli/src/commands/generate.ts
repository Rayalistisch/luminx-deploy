/**
 * `luminx generate` — bring the CMS up to date with the config (§8.4).
 *
 * The eight steps of §8.1 run in order, and steps 1–6 are pure: load, validate, probe, compile,
 * introspect, diff. Only step 8 writes, and step 8 is M8. Until then this command requires
 * `--dry-run`, rather than pretending to apply and quietly doing nothing.
 */

import { checkCapabilities, compile, diff, loadConfig, readLockfile } from '@luminx/core';
import type { AdapterRegistry } from '@luminx/core';
import { probeProject } from '@luminx/parsers';
import { ErrorCode, luminxError } from '@luminx/shared';
import type { LuminxError, Plan } from '@luminx/shared';

import { ExitCode, exitCodeFor, exitCodeForAll } from '../exit.js';
import type { Io } from '../io.js';
import { paint, renderErrors, renderJson, renderPlan } from '../render.js';

export interface GenerateOptions {
  readonly configPath: string;
  readonly lockfilePath: string;
  readonly root: string;
  readonly json: boolean;
  readonly dryRun: boolean;
  readonly registry: AdapterRegistry;
}

const fail = (io: Io, errors: readonly LuminxError[], json: boolean): ExitCode => {
  if (json) io.stdout(renderJson({ ok: false, errors }));
  else io.stderr(renderErrors(io.color, errors));
  return exitCodeForAll(errors);
};

/** Steps 1–6 of §8.1. Nothing here writes, so a failure leaves the project untouched. */
const buildPlan = async (
  io: Io,
  options: GenerateOptions,
): Promise<{ plan: Plan } | { errors: readonly LuminxError[] }> => {
  const loaded = await loadConfig(options.configPath);
  if (!loaded.ok) return { errors: loaded.error };

  const compiled = compile(loaded.value);
  if (!compiled.ok) return { errors: compiled.error };

  const adapter = options.registry.resolve(compiled.value.cms);
  if (!adapter.ok) return { errors: [adapter.error] };

  const supported = checkCapabilities(
    compiled.value.model,
    adapter.value.capabilities,
    adapter.value.id,
  );
  if (!supported.ok) return { errors: supported.error };

  const lockfile = await readLockfile(options.lockfilePath);
  if (!lockfile.ok) return { errors: lockfile.error };

  const facts = await probeProject(options.root);
  const context = { root: options.root, facts };

  const detected = await adapter.value.detect(context);
  if (!detected.ok) return { errors: [detected.error] };

  const current = await adapter.value.introspect(context);
  if (!current.ok) return { errors: [current.error] };

  if (!options.json) {
    io.stdout(
      `\n  ${paint(io.color, 'bold', 'CMS')}      ${adapter.value.id} ${detected.value.version}` +
        `   runner: ${facts.runner}\n\n`,
    );
  }

  const plan = diff({
    desired: compiled.value,
    current: current.value,
    lockfile: lockfile.value,
  });

  return plan.ok ? { plan: plan.value } : { errors: plan.error };
};

export const runGenerate = async (io: Io, options: GenerateOptions): Promise<ExitCode> => {
  // Apply lands in M8. Saying so beats writing nothing and exiting 0.
  if (!options.dryRun) {
    const error = luminxError(
      ErrorCode.ApplyOperationFailed,
      'Applying a plan lands with M8. Use --dry-run to see what would change.',
    );
    io.stderr(renderErrors(io.color, [error]));
    return exitCodeFor(error);
  }

  const result = await buildPlan(io, options);
  if ('errors' in result) return fail(io, result.errors, options.json);

  if (options.json) io.stdout(renderJson(result.plan));
  else io.stdout(renderPlan(io.color, result.plan));

  return ExitCode.Success;
};
