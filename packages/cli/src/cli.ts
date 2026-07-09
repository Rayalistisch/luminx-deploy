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

import { ExitCode } from './exit.js';
import type { Io } from './io.js';
import { paint } from './render.js';
import { runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const DEFAULT_CONFIG = 'luminx.config.json';

/**
 * Names that exist so nobody else takes them, and so `luminx generate` says something better
 * than "unknown command". Each says which milestone it arrives in and exits non-zero: a
 * pipeline calling `deploy` must never conclude that it deployed.
 */
const RESERVED: Readonly<Record<string, string>> = {
  plan: '`plan` needs the differ. It lands with M12. See docs/architecture.md §8.4.',
  generate: '`generate` needs the differ and an adapter. It lands with M5.',
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
  generate             (M5)  Bring the CMS up to date with the config.
  sync                 (M10) Reconcile both sides and show drift.
  plan                 (M12) Compute a plan as a reviewable artefact.
  undo                 (M8)  Restore the last snapshot.
  deploy               (1.x) Apply a reviewed plan to another environment.

Options
  --config <path>      Path to luminx.config.json (default: ./${DEFAULT_CONFIG})
  --cwd <path>         Project root (default: the working directory)
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
  readonly cwd: string | undefined;
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
        cwd: { type: 'string' },
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

  return {
    command: positionals[0],
    config: values.config,
    cwd: values.cwd,
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

const configPathOf = (parsed: ParsedCli, cwd: string): string => {
  const root = parsed.cwd === undefined ? cwd : resolve(cwd, parsed.cwd);
  const config = parsed.config ?? DEFAULT_CONFIG;
  return isAbsolute(config) ? config : resolve(root, config);
};

export const runCommand = async (parsed: ParsedCli, io: Io, cwd: string): Promise<ExitCode> => {
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

  const configPath = configPathOf(parsed, cwd);

  switch (parsed.command) {
    case 'init':
      return runInit(io, {
        configPath,
        force: parsed.force,
        cms: parsed.cms,
        siteName: parsed.siteName,
      });

    case 'doctor':
      return runDoctor(io, { configPath, json: parsed.json });

    default:
      throw new UsageError(`Unknown command: ${parsed.command}`);
  }
};
