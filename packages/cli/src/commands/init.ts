/**
 * `luminx init` — writes a minimal, valid `luminx.config.json` (docs/architecture.md §8.4).
 *
 * `--from-existing` introspects a CMS that already has a content model and writes the config that
 * describes it: the migration path in for a project adopting LuminX. It is also self-checking. It
 * compiles what it wrote and diffs it against what it read, and a non-empty diff is an
 * introspection gap surfaced at exactly the moment it matters (§14, M11).
 *
 * Neither mode writes to the CMS. `init` only ever reads.
 */

import { access, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { compile, decompile, diff, validateConfig } from '@luminx/core';
import { probeProject } from '@luminx/parsers';
import { ErrorCode, isNoop, luminxError } from '@luminx/shared';

import { ExitCode, exitCodeFor } from '../exit.js';
import type { Io } from '../io.js';
import { paint, renderErrors } from '../render.js';
import type { RegistryFactory } from './pipeline.js';

export interface InitOptions {
  readonly configPath: string;
  readonly force: boolean;
  /** Skips the prompts. Present as a flag so `init` is usable from a script. */
  readonly cms?: string | undefined;
  readonly siteName?: string | undefined;
  /** Introspect an existing CMS and write the config describing it. */
  readonly fromExisting: boolean;
  readonly root: string;
  readonly registryFor: RegistryFactory;
  readonly registry?: import('@luminx/core').AdapterRegistry;
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const alreadyThere = (io: Io, configPath: string): ExitCode => {
  io.stderr(
    renderErrors(io.color, [
      luminxError(ErrorCode.ConfigSchemaViolation, `${configPath} already exists`, {
        hint: 'Pass --force to overwrite it.',
      }),
    ]),
  );
  return ExitCode.ConfigError;
};

const write = async (io: Io, configPath: string, config: unknown): Promise<ExitCode> => {
  // Validating what we just wrote is cheap, and a broken init would poison every command after it.
  const validated = validateConfig(config);
  if (!validated.ok) {
    io.stderr(renderErrors(io.color, validated.error));
    return ExitCode.InternalError;
  }

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  io.stdout(`${paint(io.color, 'green', '✔')} Wrote ${configPath}\n`);
  return ExitCode.Success;
};

const fromExisting = async (io: Io, options: InitOptions): Promise<ExitCode> => {
  const facts = await probeProject(options.root);
  const registry = options.registry ?? options.registryFor(facts);
  const cms = options.cms ?? 'craft';

  const adapter = registry.resolve(cms);
  if (!adapter.ok) {
    io.stderr(renderErrors(io.color, [adapter.error]));
    return exitCodeFor(adapter.error);
  }

  const context = { root: options.root, facts };

  const detected = await adapter.value.detect(context);
  if (!detected.ok) {
    io.stderr(renderErrors(io.color, [detected.error]));
    return exitCodeFor(detected.error);
  }

  const current = await adapter.value.introspect(context);
  if (!current.ok) {
    io.stderr(renderErrors(io.color, [current.error]));
    return exitCodeFor(current.error);
  }

  const config = decompile(
    cms,
    [...current.value.resources.values()].map((entry) => entry.resource),
  );

  const code = await write(io, options.configPath, config);
  if (code !== ExitCode.Success) return code;

  io.stdout(`  Read ${current.value.resources.size} resources from ${cms}.\n`);

  // The round-trip check (§14): compile what we wrote, diff against what we read. Empty means the
  // config is a faithful description, and the first `generate` will report only skips. A non-empty
  // diff is an introspection gap, and the user should know before they trust the file.
  const compiled = compile(config);
  if (compiled.ok) {
    const plan = diff({ desired: compiled.value, current: current.value, lockfile: null });
    if (plan.ok && !isNoop(plan.value)) {
      io.stdout(
        `\n  ${paint(io.color, 'yellow', '!')} The generated config does not fully round-trip: ` +
          `${plan.value.operations.filter((op) => op.kind !== 'skip').length} resource(s) still differ.\n` +
          `    This is a gap in introspection. Please report it.\n`,
      );
    }
  }

  io.stdout(
    `  Next: review it, then run ${paint(io.color, 'bold', 'luminx generate --dry-run')}.\n`,
  );
  return ExitCode.Success;
};

export const runInit = async (io: Io, options: InitOptions): Promise<ExitCode> => {
  if (!options.force && (await exists(options.configPath))) {
    return alreadyThere(io, options.configPath);
  }

  if (options.fromExisting) return fromExisting(io, options);

  const cms = options.cms ?? (await io.ask('Which CMS?', 'craft'));
  const siteName =
    options.siteName ?? (await io.ask('Site name?', basename(dirname(options.configPath))));

  const config = {
    $schema: 'https://luminx.dev/schema/v1.json',
    version: 1 as const,
    cms,
    siteName,
  };

  const code = await write(io, options.configPath, config);
  if (code !== ExitCode.Success) return code;

  io.stdout(
    `  Next: describe your content model, then run ${paint(io.color, 'bold', 'luminx doctor')}.\n`,
  );
  return ExitCode.Success;
};
