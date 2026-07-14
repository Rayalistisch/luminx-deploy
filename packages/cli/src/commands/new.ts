/**
 * `luminx new` — an empty directory in, a running CMS with your content model out.
 *
 * Every other command reconciles a CMS that exists. This one brings it into being, and it is the
 * only place LuminX creates rather than converges. It is a thin orchestration on purpose: the
 * adapter does the standing-up (it is the only one who knows how), and this file does what the
 * CLI always does — ask, report, and map the outcome to an exit code.
 *
 * Afterwards it writes a starter config and applies it, so the last step of `new` is the first
 * step of every other day: a `generate` that converges.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

import {
  checkCapabilities,
  compile,
  diff,
  execute,
  parseConfig,
  validateConfig,
  writeLockfile,
} from '@luminx/core';
import type { AdapterRegistry, LuminxConfig, ScaffoldResult } from '@luminx/core';
import { probeProject } from '@luminx/parsers';
import { ErrorCode, luminxError, ok } from '@luminx/shared';
import type { LuminxError, Result } from '@luminx/shared';

import { ExitCode, exitCodeFor, exitCodeForAll } from '../exit.js';
import type { Io } from '../io.js';
import { paint, renderErrors } from '../render.js';
import type { RegistryFactory } from './pipeline.js';

export interface NewOptions {
  readonly root: string;
  readonly configPath: string;
  readonly lockfilePath: string;
  readonly cms: string;
  readonly siteName: string | undefined;
  readonly adminEmail: string | undefined;
  readonly adminPassword: string | undefined;
  /** Adapter-specific knobs: php, database, pluginPath. Opaque to the CLI. */
  readonly knobs: Readonly<Record<string, string>>;
  readonly registryFor: RegistryFactory;
  readonly registry?: AdapterRegistry;
}

/**
 * A starter model, not an empty one. `new` that leaves you with nothing to look at has taught you
 * nothing about whether it worked; this gives the first `generate` something real to converge on.
 */
const starterConfig = (cms: string, siteName: string) => ({
  $schema: 'https://luminx.dev/schema/v1.json',
  version: 1 as const,
  cms,
  siteName,
  sections: [
    {
      handle: 'pages',
      name: 'Pages',
      type: 'structure' as const,
      maxLevels: 3,
      uriFormat: '{slug}',
      template: '_pages/entry',
      entryTypes: [
        {
          handle: 'page',
          name: 'Page',
          fields: [
            { handle: 'heading', type: 'text' as const, name: 'Heading', max: 120, required: true },
          ],
        },
      ],
    },
  ],
});

/**
 * The config, if there is one — `null` if there is not.
 *
 * Not `core`'s `loadConfig`, which treats a missing file as an error and points at `luminx init`.
 * For every other command that is right; for this one, absence is the ordinary case and the reason
 * the starter exists. A malformed config still fails, and loudly: it means the user wrote something
 * they meant, and quietly replacing it with the starter would be the worst answer available.
 */
const loadConfig = async (
  path: string,
): Promise<Result<LuminxConfig | null, readonly LuminxError[]>> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ok(null);
    throw error;
  }

  return parseConfig(text, path);
};

export const runNew = async (io: Io, options: NewOptions): Promise<ExitCode> => {
  const facts = await probeProject(options.root);
  const registry = options.registry ?? options.registryFor(facts);

  const adapter = registry.resolve(options.cms);
  if (!adapter.ok) {
    io.stderr(renderErrors(io.color, [adapter.error]));
    return exitCodeFor(adapter.error);
  }

  // An adapter that cannot stand its CMS up says so, rather than the CLI pretending it can.
  if (adapter.value.scaffold === undefined) {
    const error = luminxError(
      ErrorCode.EnvCmsNotDetected,
      `The "${adapter.value.id}" adapter cannot create a project`,
      { hint: 'Only some CMSes can be scaffolded. Set one up by hand, then run `luminx init`.' },
    );
    io.stderr(renderErrors(io.color, [error]));
    return exitCodeFor(error);
  }

  const siteName = options.siteName ?? (await io.ask('Site name?', basename(options.root)));
  const email = options.adminEmail ?? (await io.ask('Admin email?', 'admin@example.test'));
  const password = options.adminPassword ?? (await io.ask('Admin password?', 'luminx-change-me'));

  io.stdout(
    `\n  Creating a ${paint(io.color, 'bold', options.cms)} project in ${options.root}\n\n`,
  );

  const scaffolded = await adapter.value.scaffold(
    {
      root: options.root,
      siteName,
      admin: { username: 'admin', email, password },
      options: options.knobs,
    },
    {
      onStep: (message) => io.stdout(`  ${paint(io.color, 'dim', '·')} ${message}…\n`),
    },
  );

  if (!scaffolded.ok) {
    io.stderr(`\n${renderErrors(io.color, [scaffolded.error])}`);
    return exitCodeFor(scaffolded.error);
  }

  const result: ScaffoldResult = scaffolded.value;
  io.stdout(`\n  ${paint(io.color, 'green', '✔')} ${options.cms} ${result.version} is running.\n`);

  /**
   * A config that is already there is the whole reason the CMS is being stood up.
   *
   * `luminx import` reads an Astro site's content model and writes it here; the next step is a CMS
   * that holds that model. This command used to overwrite it with the starter — silently throwing
   * away the model the user came for, and standing up a CMS for a blog nobody asked for. The
   * starter exists for an empty start, not to bulldoze an answer we already have.
   */
  const existing = await loadConfig(options.configPath);
  if (!existing.ok) return fail(io, existing.error);

  const adopted = existing.value !== null;
  const config = adopted ? existing.value : starterConfig(options.cms, siteName);

  const validated = validateConfig(config);
  if (!validated.ok) return fail(io, validated.error);

  if (adopted) {
    io.stdout(`  ${paint(io.color, 'green', '✔')} Using ${options.configPath}\n`);
  } else {
    await writeFile(options.configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    io.stdout(`  ${paint(io.color, 'green', '✔')} Wrote ${options.configPath}\n`);
  }

  const compiled = compile(validated.value);
  if (!compiled.ok) return fail(io, compiled.error);

  // The project only exists now, so its facts must be read again: the CMS was not installed when
  // this command started, and an adapter built on the old facts would not find it.
  const built = await probeProject(options.root);
  const live = (options.registry ?? options.registryFor(built)).resolve(options.cms);
  if (!live.ok) return fail(io, [live.error]);

  /**
   * The gate every other command goes through (`buildPlan`, pipeline.ts), and this one skipped.
   *
   * A model the CMS cannot hold — a field named `title` on Craft, where entries already have one —
   * used to get all the way to the writing, fail on the eighth resource, and leave a half-built CMS
   * behind. The check knows this before a single write; `new` simply never asked it. Refusing a
   * whole plan costs a message. Refusing it halfway costs a rollback.
   */
  const supported = checkCapabilities(compiled.value.model, live.value.capabilities, live.value.id);
  if (!supported.ok) return fail(io, supported.error);

  const context = { root: options.root, facts: built };

  const current = await live.value.introspect(context);
  if (!current.ok) return fail(io, [current.error]);

  const plan = diff({ desired: compiled.value, current: current.value, lockfile: null });
  if (!plan.ok) return fail(io, plan.error);

  io.stdout(`\n  Applying the ${adopted ? 'content model' : 'starter content model'}…\n`);

  const report = await execute({
    plan: plan.value,
    adapter: live.value,
    context,
    current: current.value,
    onOperation: (operation, applied) =>
      io.stdout(
        `  ${paint(io.color, 'dim', applied.status.padEnd(8))} ${operation.resource.logicalId}\n`,
      ),
  });

  await writeLockfile(options.lockfilePath, report.lockfile);

  if (report.failure !== undefined) {
    io.stderr(`\n${renderErrors(io.color, [report.failure])}`);
    return exitCodeFor(report.failure);
  }

  io.stdout(
    `\n  ${paint(io.color, 'green', '✔')} Applied ${report.results.length} operations.\n\n`,
  );
  for (const note of result.notes) io.stdout(`  ${note}\n`);

  return ExitCode.Success;
};

const fail = (io: Io, errors: readonly import('@luminx/shared').LuminxError[]): ExitCode => {
  io.stderr(renderErrors(io.color, errors));
  return exitCodeForAll(errors);
};
