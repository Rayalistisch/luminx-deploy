/**
 * `luminx doctor` — never mutates. Runs independent checks and reports pass / warn / fail with
 * a fix for anything actionable (docs/architecture.md §8.4).
 *
 * In M3 the checks are the generic ones: the environment LuminX itself needs, and whether the
 * config can be read, validated and compiled. The CMS-side checks arrive with the adapter (M7),
 * which is why `adapter` reports a warning rather than pretending to know.
 */

import { compile, loadConfig } from '@luminx/core';
import { probeProject } from '@luminx/parsers';
import type { ProjectFacts } from '@luminx/parsers';
import type { HealthCheck, LuminxError } from '@luminx/shared';

import { ExitCode, exitCodeForAll } from '../exit.js';
import type { Io } from '../io.js';
import { renderChecks, renderErrors, renderJson } from '../render.js';

export interface DoctorOptions {
  readonly configPath: string;
  readonly root: string;
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

/** What the project looks like from the outside. None of this needs the CMS to be reachable. */
const projectChecks = (facts: ProjectFacts): readonly HealthCheck[] => {
  const checks: HealthCheck[] = [];

  if (facts.composer === null) {
    checks.push({
      id: 'project.composer',
      label: 'Composer project',
      status: 'warn',
      detail: 'no readable composer.json',
      fix: 'LuminX targets PHP CMSes. Is this the project root?',
    });
  } else if (facts.composer.lock === 'unreadable') {
    // Not the same as never having installed: this lock file exists and lies.
    checks.push({
      id: 'project.composer',
      label: 'Composer project',
      status: 'fail',
      detail: 'composer.lock is corrupt',
      fix: 'Run `composer install` to regenerate it.',
    });
  } else if (facts.composer.lock === 'absent') {
    checks.push({
      id: 'project.composer',
      label: 'Composer project',
      status: 'warn',
      detail: 'no composer.lock; nothing is installed',
      fix: 'Run `composer install`.',
    });
  } else {
    checks.push({
      id: 'project.composer',
      label: 'Composer project',
      status: 'pass',
      detail: `${Object.keys(facts.composer.installed).length} packages installed`,
    });
  }

  checks.push({
    id: 'project.runner',
    label: 'Runner',
    status: 'pass',
    detail:
      facts.detectedRunners.length > 1
        ? `${facts.runner} (also found: ${facts.detectedRunners.slice(1).join(', ')})`
        : facts.runner,
    ...(facts.runner === 'local'
      ? { fix: 'No container markers found. LuminX will call PHP directly.' }
      : {}),
  });

  if (facts.frameworks.length > 0) {
    checks.push({
      id: 'project.frontend',
      label: 'Frontend',
      status: 'pass',
      detail: facts.frameworks.map((f) => `${f.id} ${f.constraint}`).join(', '),
    });
  }

  return checks;
};

export const collectChecks = async (configPath: string, root: string): Promise<DoctorReport> => {
  const facts = await probeProject(root);
  const checks: HealthCheck[] = [checkNode(process.version), ...projectChecks(facts)];

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
  const report = await collectChecks(options.configPath, options.root);

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
