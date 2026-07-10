/**
 * The read-only pipeline `generate` and `sync` share (§8.1 steps 1–6, §15 decision 4).
 *
 * Two commands, one pipeline. `generate` and `sync` differ in attitude — additive versus
 * reconciling — not in how they load, validate, probe, compile, introspect and diff. Nothing
 * here writes, so a failure leaves the project exactly as it was.
 */

import { checkCapabilities, compile, diff, loadConfig, readLockfile } from '@luminx/core';
import type {
  AdapterContext,
  AdapterRegistry,
  CmsAdapter,
  CompiledModel,
  Lockfile,
} from '@luminx/core';
import { probeProject } from '@luminx/parsers';
import type { CurrentModel, LuminxError, Plan, ProjectFacts } from '@luminx/shared';

import { exitCodeForAll, type ExitCode } from '../exit.js';
import type { Io } from '../io.js';
import { paint, renderErrors, renderJson } from '../render.js';

export type RegistryFactory = (facts: ProjectFacts) => AdapterRegistry;

export interface PipelineOptions {
  readonly configPath: string;
  readonly lockfilePath: string;
  readonly root: string;
  readonly json: boolean;
  readonly registryFor: RegistryFactory;
  /** Overrides the factory. Tests use it to plan against the in-memory adapter. */
  readonly registry?: AdapterRegistry;
  /** Deletes for orphans. Only `sync --prune` sets it; `generate` never deletes (§8.2). */
  readonly prune?: boolean;
}

export interface Planned {
  readonly plan: Plan;
  readonly adapter: CmsAdapter;
  readonly context: AdapterContext;
  readonly current: CurrentModel;
  /** Kept so `sync` can tell drift from an ordinary update, which needs the lockfile. */
  readonly desired: CompiledModel;
  readonly lockfile: Lockfile | null;
}

export const fail = (io: Io, errors: readonly LuminxError[], json: boolean): ExitCode => {
  if (json) io.stdout(renderJson({ ok: false, errors }));
  else io.stderr(renderErrors(io.color, errors));
  return exitCodeForAll(errors);
};

/** Steps 1–6. Returns the plan and everything a command needs to act on it, or the errors. */
export const buildPlan = async (
  io: Io,
  options: PipelineOptions,
): Promise<Planned | { errors: readonly LuminxError[] }> => {
  const loaded = await loadConfig(options.configPath);
  if (!loaded.ok) return { errors: loaded.error };

  const compiled = compile(loaded.value);
  if (!compiled.ok) return { errors: compiled.error };

  // PROBE before the adapter exists: an adapter's capabilities depend on which plugins the
  // project installed, so it cannot be built until the project has been read (§8.1, step 3).
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
    ...(options.prune === undefined ? {} : { prune: options.prune }),
  });

  return plan.ok
    ? {
        plan: plan.value,
        adapter: adapter.value,
        context,
        current: current.value,
        desired: compiled.value,
        lockfile: lockfile.value,
      }
    : { errors: plan.error };
};
