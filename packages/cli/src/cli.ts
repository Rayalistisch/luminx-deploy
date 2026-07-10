/**
 * The composition root (docs/architecture.md §3.5). Parses arguments, wires dependencies and
 * maps outcomes to exit codes. It holds no planning logic and knows no adapter beyond a name.
 *
 * Argument parsing uses `node:util`'s parseArgs. A CLI framework would be the first dependency
 * the user installs and the last one they benefit from.
 */

import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { createCraftAdapter, createRunner } from '@luminx/adapter-craft';
import { createMemoryAdapter, createRegistry } from '@luminx/core';
import type { AdapterRegistry } from '@luminx/core';
import { isRunnerId } from '@luminx/parsers';
import type { ProjectFacts, RunnerId } from '@luminx/shared';

import { ExitCode } from './exit.js';
import type { Io } from './io.js';
import { paint } from './render.js';
import { runDoctor } from './commands/doctor.js';
import { runGenerate } from './commands/generate.js';
import { runInit } from './commands/init.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const DEFAULT_CONFIG = 'luminx.config.json';
const DEFAULT_LOCKFILE = 'luminx.lock.json';

/**
 * The composition root registers adapters, and nothing else may (§4).
 *
 * It takes ProjectFacts because an adapter's capabilities depend on what the project installed:
 * `richtext` exists only where CKEditor does. So the registry is built after the probe, not
 * before — which is also why this is a factory and not a constant.
 */
export const registryFor =
  (runnerId: RunnerId | undefined, onCommand?: (command: string) => void) =>
  (facts: ProjectFacts): AdapterRegistry => {
    const runner = createRunner(runnerId ?? facts.runner, { cwd: facts.root });

    return createRegistry([
      // Ships so `generate --dry-run` works with no CMS at all, and so the fake adapter the
      // tests use is the same one a user can point `"cms": "memory"` at.
      createMemoryAdapter(),
      createCraftAdapter({
        runner,
        facts,
        ...(onCommand === undefined ? {} : { onCommand }),
      }),
    ]);
  };

/**
 * Names that exist so nobody else takes them, and so `luminx generate` says something better
 * than "unknown command". Each says which milestone it arrives in and exits non-zero: a
 * pipeline calling `deploy` must never conclude that it deployed.
 */
const RESERVED: Readonly<Record<string, string>> = {
  plan: '`plan` writes the plan as a reviewable artefact. It lands with M12.',
  sync: '`sync` needs drift detection. It lands with M10.',
  undo: '`undo` needs snapshots. It lands with M8.',
  deploy: '`deploy` is planned for LuminX 1.x. See docs/architecture.md §11.',
};

const USAGE = `luminx ${version}

Usage
  luminx <command> [options]

Commands
  init                 Write a minimal luminx.config.json. Never touches the CMS.
  doctor               Check the environment and the config. Never mutates.
  generate --dry-run   Show what would change. Writing lands with M8.
  sync                 (M10) Reconcile both sides and show drift.
  plan                 (M12) Compute a plan as a reviewable artefact.
  undo                 (M8)  Restore the last snapshot.
  deploy               (1.x) Apply a reviewed plan to another environment.

Options
  --config <path>      Path to luminx.config.json (default: ./${DEFAULT_CONFIG})
  --lockfile <path>    Path to luminx.lock.json (default: ./${DEFAULT_LOCKFILE})
  --cwd <path>         Project root (default: the working directory)
  --runner <name>      ddev | docker | local (default: detected)
  --dry-run            Compute the plan and write nothing
  --verbose, -V        Print every command used to reach PHP
  --json               Machine-readable output on stdout
  --yes, -y            Never prompt. For CI.
  --no-color           Disable colour
  --force              init: overwrite an existing config
  --cms <id>           init: skip the prompt
  --site-name <name>   init: skip the prompt
  -h, --help           Show this
  -v, --version        Show the version
`;

export interface ParsedCli {
  readonly command: string | undefined;
  readonly config: string | undefined;
  readonly lockfile: string | undefined;
  readonly cwd: string | undefined;
  readonly runner: RunnerId | undefined;
  readonly verbose: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly yes: boolean;
  readonly color: boolean;
  readonly force: boolean;
  readonly cms: string | undefined;
  readonly siteName: string | undefined;
  readonly help: boolean;
  readonly version: boolean;
}

export class UsageError extends Error {}

export const parseCli = (argv: readonly string[]): ParsedCli => {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        config: { type: 'string' },
        lockfile: { type: 'string' },
        cwd: { type: 'string' },
        runner: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        verbose: { type: 'boolean', short: 'V', default: false },
        json: { type: 'boolean', default: false },
        yes: { type: 'boolean', short: 'y', default: false },
        'no-color': { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        cms: { type: 'string' },
        'site-name': { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (error: unknown) {
    throw new UsageError(error instanceof Error ? error.message : 'Could not parse arguments');
  }

  const { values, positionals } = parsed;

  if (positionals.length > 1) {
    throw new UsageError(`Expected one command, got: ${positionals.join(', ')}`);
  }

  const runner = values.runner;

  if (runner !== undefined && !isRunnerId(runner)) {
    throw new UsageError(`Unknown runner "${runner}". Use ddev, docker or local.`);
  }

  return {
    command: positionals[0],
    config: values.config,
    lockfile: values.lockfile,
    cwd: values.cwd,
    runner,
    verbose: values.verbose ?? false,
    dryRun: values['dry-run'] ?? false,
    json: values.json ?? false,
    yes: values.yes ?? false,
    color: !(values['no-color'] ?? false),
    force: values.force ?? false,
    cms: values.cms,
    siteName: values['site-name'],
    help: values.help ?? false,
    version: values.version ?? false,
  };
};

/** The project root and the config path are separate: `--config` may point outside the project. */
const locate = (
  parsed: ParsedCli,
  cwd: string,
): { root: string; configPath: string; lockfilePath: string } => {
  const root = parsed.cwd === undefined ? cwd : resolve(cwd, parsed.cwd);
  const under = (path: string) => (isAbsolute(path) ? path : resolve(root, path));

  return {
    root,
    configPath: under(parsed.config ?? DEFAULT_CONFIG),
    lockfilePath: under(parsed.lockfile ?? DEFAULT_LOCKFILE),
  };
};

export const runCommand = async (
  parsed: ParsedCli,
  io: Io,
  cwd: string,
  registry?: AdapterRegistry,
): Promise<ExitCode> => {
  if (parsed.version) {
    io.stdout(`${version}\n`);
    return ExitCode.Success;
  }

  if (parsed.help) {
    io.stdout(USAGE);
    return ExitCode.Success;
  }

  // Asked for, it is output. Reached by mistake, it is a diagnostic — and belongs on stderr,
  // where it cannot corrupt a `luminx ... > file` the user meant to fill with something else.
  if (parsed.command === undefined) {
    io.stderr(USAGE);
    return ExitCode.ConfigError;
  }

  const reserved = RESERVED[parsed.command];
  if (reserved !== undefined) {
    io.stderr(`${paint(io.color, 'yellow', '!')} ${reserved}\n`);
    return ExitCode.ConfigError;
  }

  const { root, configPath, lockfilePath } = locate(parsed, cwd);

  // `--verbose` prints the exact command each runner will execute, which is the only way to see
  // what LuminX actually did to reach PHP (§7.3).
  const verbose = parsed.verbose
    ? (command: string) => io.stderr(`${paint(io.color, 'dim', `$ ${command}`)}\n`)
    : undefined;

  switch (parsed.command) {
    case 'init':
      return runInit(io, {
        configPath,
        force: parsed.force,
        cms: parsed.cms,
        siteName: parsed.siteName,
      });

    case 'doctor':
      return runDoctor(io, {
        configPath,
        root,
        json: parsed.json,
        registryFor: registryFor(parsed.runner, verbose),
        ...(registry === undefined ? {} : { registry }),
      });

    case 'generate':
      return runGenerate(io, {
        configPath,
        lockfilePath,
        root,
        json: parsed.json,
        dryRun: parsed.dryRun,
        registryFor: registryFor(parsed.runner, verbose),
        ...(registry === undefined ? {} : { registry }),
      });

    default:
      throw new UsageError(`Unknown command: ${parsed.command}`);
  }
};
