/**
 * `luminx generate` — bring the CMS up to date with the config (§8.4).
 *
 * The eight steps of §8.1 run in order, and steps 1–6 are pure: load, validate, probe, compile,
 * introspect, diff. Only step 8 writes, and it writes nothing without a snapshot and a yes.
 */

import {
  checkCapabilities,
  compile,
  diff,
  execute,
  loadConfig,
  readLockfile,
  writeLockfile,
} from '@luminx/core';
import type { AdapterContext, AdapterRegistry, CmsAdapter } from '@luminx/core';
import { probeProject } from '@luminx/parsers';
import { isNoop } from '@luminx/shared';
import type { CurrentModel, LuminxError, Plan, ProjectFacts } from '@luminx/shared';

import { ExitCode, exitCodeFor, exitCodeForAll } from '../exit.js';
import type { Io } from '../io.js';
import { paint, renderErrors, renderJson, renderPlan } from '../render.js';

/** Adapters can only be built once the project has been read, so the CLI passes a factory. */
export type RegistryFactory = (facts: ProjectFacts) => AdapterRegistry;

export interface GenerateOptions {
  readonly configPath: string;
  readonly lockfilePath: string;
  readonly root: string;
  readonly json: boolean;
  readonly dryRun: boolean;
  readonly registryFor: RegistryFactory;
  /** Overrides the factory. Tests use it to plan against the in-memory adapter. */
  readonly registry?: AdapterRegistry;
}

const fail = (io: Io, errors: readonly LuminxError[], json: boolean): ExitCode => {
  if (json) io.stdout(renderJson({ ok: false, errors }));
  else io.stderr(renderErrors(io.color, errors));
  return exitCodeForAll(errors);
};

interface Planned {
  readonly plan: Plan;
  readonly adapter: CmsAdapter;
  readonly context: AdapterContext;
  readonly current: CurrentModel;
}

/** Steps 1–6 of §8.1. Nothing here writes, so a failure leaves the project untouched. */
const buildPlan = async (
  io: Io,
  options: GenerateOptions,
): Promise<Planned | { errors: readonly LuminxError[] }> => {
  const loaded = await loadConfig(options.configPath);
  if (!loaded.ok) return { errors: loaded.error };

  const compiled = compile(loaded.value);
  if (!compiled.ok) return { errors: compiled.error };

  // PROBE before the adapter exists: an adapter's capabilities depend on which plugins the
  // project has installed, so it cannot be built until the project has been read (§8.1, step 3).
  const facts = await probeProject(options.root);

  const registry = options.registry ?? options.registryFor(facts);
  const adapter = registry.resolve(compiled.value.cms);
  if (!adapter.ok) return { errors: [adapter.error] };

  const supported = checkCapabilities(
    compiled.value.model,
    adapter.value.capabilities,
    adapter.value.id,
  );
  if (!supported.ok) return { errors: supported.error };

  const lockfile = await readLockfile(options.lockfilePath);
  if (!lockfile.ok) return { errors: lockfile.error };

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

  return plan.ok
    ? { plan: plan.value, adapter: adapter.value, context, current: current.value }
    : { errors: plan.error };
};

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
