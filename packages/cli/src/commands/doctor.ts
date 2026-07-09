/**
 * `luminx doctor` — never mutates. Runs independent checks and reports pass / warn / fail with
 * a fix for anything actionable (docs/architecture.md §8.4).
 *
 * In M3 the checks are the generic ones: the environment LuminX itself needs, and whether the
 * config can be read, validated and compiled. The CMS-side checks arrive with the adapter (M7),
 * which is why `adapter` reports a warning rather than pretending to know.
 */

import { compile, loadConfig } from '@luminx/core';
import type { HealthCheck, LuminxError } from '@luminx/shared';

import { ExitCode, exitCodeForAll } from '../exit.js';
import type { Io } from '../io.js';
import { renderChecks, renderErrors, renderJson } from '../render.js';

export interface DoctorOptions {
  readonly configPath: string;
  readonly json: boolean;
}

export interface DoctorReport {
  readonly checks: readonly HealthCheck[];
  readonly errors: readonly LuminxError[];
}

/**
 * dependency-cruiser, and therefore `pnpm check:cycles`, follows the Node LTS schedule and
 * refuses odd-numbered releases. `engines` says the same. An odd Node runs LuminX fine but
 * cannot run its checks, so this is a warning rather than a failure.
 */
const checkNode = (version: string): HealthCheck => {
  const major = Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '', 10);
  const supported = Number.isFinite(major) && major >= 22 && major % 2 === 0;

  return {
    id: 'env.node',
    label: 'Node.js',
    status: supported ? 'pass' : 'warn',
    detail: version,
    ...(supported ? {} : { fix: 'LuminX targets even-numbered Node lines: 22 or 24.' }),
  };
};

export const collectChecks = async (configPath: string): Promise<DoctorReport> => {
  const checks: HealthCheck[] = [checkNode(process.version)];

  const loaded = await loadConfig(configPath);

  if (!loaded.ok) {
    const missing = loaded.error.some((error) => error.code === 'LX1001');
    checks.push({
      id: 'config.load',
      label: missing ? 'Config found' : 'Config valid',
      status: 'fail',
      detail: missing ? `No config at ${configPath}` : `${loaded.error.length} problem(s)`,
      fix: missing ? 'Run `luminx init`.' : 'See the errors below.',
    });
    return { checks, errors: loaded.error };
  }

  checks.push({
    id: 'config.load',
    label: 'Config found',
    status: 'pass',
    detail: configPath,
  });

  const compiled = compile(loaded.value);

  if (!compiled.ok) {
    checks.push({
      id: 'config.compile',
      label: 'Config compiles',
      status: 'fail',
      detail: `${compiled.error.length} problem(s)`,
      fix: 'See the errors below.',
    });
    return { checks, errors: compiled.error };
  }

  checks.push({
    id: 'config.compile',
    label: 'Config compiles',
    status: 'pass',
    detail: `${compiled.value.model.resources.size} resources`,
  });

  const renames = compiled.value.renames.size;
  if (renames > 0) {
    checks.push({
      id: 'config.renames',
      label: 'Pending renames',
      status: 'warn',
      detail: `${renames} resource(s) carry previousHandle`,
      fix: 'Remove previousHandle once the rename has been applied.',
    });
  }

  checks.push({
    id: 'adapter',
    label: 'CMS adapter',
    status: 'warn',
    detail: `none registered for "${compiled.value.cms}"`,
    fix: 'Adapters land in M7. Until then doctor cannot inspect the CMS.',
  });

  return { checks, errors: [] };
};

export const runDoctor = async (io: Io, options: DoctorOptions): Promise<ExitCode> => {
  const report = await collectChecks(options.configPath);

  if (options.json) {
    io.stdout(renderJson(report));
  } else {
    io.stdout(renderChecks(io.color, report.checks));
    if (report.errors.length > 0) io.stderr(`\n${renderErrors(io.color, report.errors)}`);
  }

  if (report.errors.length > 0) return exitCodeForAll(report.errors);

  // A failing check with no error attached is about the environment, not the config.
  return report.checks.some((check) => check.status === 'fail')
    ? ExitCode.EnvironmentError
    : ExitCode.Success;
};
