/**
 * The composition root (docs/architecture.md §3.5). Parses arguments, wires dependencies and
 * maps outcomes to exit codes. It holds no planning logic and knows no adapter beyond a name.
 *
 * Argument parsing uses `node:util`'s parseArgs. A CLI framework would be the first dependency
 * the user installs and the last one they benefit from.
 */

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
import { runImport } from './commands/import.js';
import { runInit } from './commands/init.js';
import { runNew } from './commands/new.js';
import { runPlan } from './commands/plan.js';
import { runSync } from './commands/sync.js';
import { runClient } from './commands/client.js';
import { runContentPush } from './commands/content.js';
import { runTypes } from './commands/types.js';
import { runUndo } from './commands/undo.js';

/**
 * The version is a build-time fact, so it is baked in at build time (see build.js).
 *
 * Reading it from `../package.json` at runtime worked only because of where the compiled file
 * happened to sit. Bundled into `dist/bin/`, the same relative path points at nothing, and the
 * binary died on startup — for everyone but us. A constant cannot move out from under itself.
 *
 * Undeclared under vitest, which runs the source rather than the bundle; `typeof` on an undeclared
 * name is safe, and the fallback keeps `--version` semver-shaped in dev.
 */
declare const __LUMINX_VERSION__: string | undefined;
const version = typeof __LUMINX_VERSION__ === 'string' ? __LUMINX_VERSION__ : '0.0.0';

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
  deploy: '`deploy` is planned for LuminX 1.x. See docs/deploy.md.',
};

const USAGE = `luminx ${version}

Usage
  luminx <command> [options]

Commands
  new                  Create a CMS project from nothing, and apply a starter model.
  import               Read a frontend's content model into a config (Astro today).
  init                 Write a minimal luminx.config.json. Never touches the CMS.
  doctor               Check the environment and the config. Never mutates.
  generate             Bring the CMS up to date. --dry-run to see it first.
  sync                 Reconcile both sides, show drift. --check for CI, --prune to delete.
  plan                 Write the plan as a reviewable artefact. -o to a file.
  types                Emit TypeScript types for your frontend. -o to a file.
  content push         Write your markdown into the CMS. Upserts on slug; never deletes.
  client               Generate a typed client that reads the CMS. Opens a read-only token.
  undo                 Restore the snapshot taken before the last apply.
  deploy               (1.x) Apply a reviewed plan to another environment. See docs/deploy.md.

Options
  --config <path>      Path to luminx.config.json (default: ./${DEFAULT_CONFIG})
  --lockfile <path>    Path to luminx.lock.json (default: ./${DEFAULT_LOCKFILE})
  --cwd <path>         Project root (default: the working directory)
  --runner <name>      ddev | docker | local (default: detected)
  --dry-run            Compute the plan and write nothing
  --out, -o <path>     plan/types: write the output to a file
  --check              sync: exit 1 if the CMS and config have diverged. For CI.
  --prune              sync: delete resources the config no longer describes
  --verbose, -V        Print every command used to reach PHP
  --json               Machine-readable output on stdout
  --yes, -y            Never prompt. For CI.
  --no-color           Disable colour
  --list               undo: show the snapshots that exist
  --id <id>            undo: restore a particular snapshot
  --force              init: overwrite an existing config
  --from-existing      init: write the config from a CMS that already has a model
  --from <path>        import: the frontend's content schema (default: src/content/config.ts)
  --cms <id>           init/new: which CMS (default: craft)
  --site-name <name>   init/new: skip the prompt
  --admin-email <a>    new: admin address
  --admin-password <p> new: admin password
  --php <version>      new: PHP version (default: 8.3)
  --database <spec>    new: database (default: mysql:8.0)
  --plugin-path <path> new: install craft-luminx from a local checkout
  --section <handle>   content push: which section to write into
  --env <path>         client: where to write the token (default: .env)
  -h, --help           Show this
  -v, --version        Show the version
`;

export interface ParsedCli {
  readonly command: string | undefined;
  /** `luminx content push` — the verb after the noun, for commands that have one. */
  readonly subcommand: string | undefined;
  readonly section: string | undefined;
  readonly env: string | undefined;
  readonly config: string | undefined;
  readonly lockfile: string | undefined;
  readonly cwd: string | undefined;
  readonly runner: RunnerId | undefined;
  readonly verbose: boolean;
  readonly dryRun: boolean;
  readonly fromExisting: boolean;
  readonly check: boolean;
  readonly prune: boolean;
  readonly json: boolean;
  readonly yes: boolean;
  readonly color: boolean;
  readonly force: boolean;
  readonly list: boolean;
  readonly id: string | undefined;
  readonly out: string | undefined;
  readonly cms: string | undefined;
  readonly siteName: string | undefined;
  readonly adminEmail: string | undefined;
  readonly adminPassword: string | undefined;
  readonly php: string | undefined;
  readonly database: string | undefined;
  readonly pluginPath: string | undefined;
  readonly from: string | undefined;
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
        'from-existing': { type: 'boolean', default: false },
        check: { type: 'boolean', default: false },
        prune: { type: 'boolean', default: false },
        verbose: { type: 'boolean', short: 'V', default: false },
        json: { type: 'boolean', default: false },
        yes: { type: 'boolean', short: 'y', default: false },
        'no-color': { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        list: { type: 'boolean', default: false },
        id: { type: 'string' },
        out: { type: 'string', short: 'o' },
        cms: { type: 'string' },
        'site-name': { type: 'string' },
        'admin-email': { type: 'string' },
        'admin-password': { type: 'string' },
        php: { type: 'string' },
        database: { type: 'string' },
        'plugin-path': { type: 'string' },
        from: { type: 'string' },
        section: { type: 'string' },
        env: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (error: unknown) {
    throw new UsageError(error instanceof Error ? error.message : 'Could not parse arguments');
  }

  const { values, positionals } = parsed;

  /**
   * One word, except where the noun needs a verb.
   *
   * `content` alone must not do anything — it writes to a database, and a command that guesses at
   * what you meant is the last thing that should. So `content push` is two words on purpose, and
   * everything else stays one.
   */
  const takesVerb = positionals[0] === 'content';
  const allowed = takesVerb ? 2 : 1;

  if (positionals.length > allowed) {
    throw new UsageError(`Expected one command, got: ${positionals.join(', ')}`);
  }

  const runner = values.runner;

  if (runner !== undefined && !isRunnerId(runner)) {
    throw new UsageError(`Unknown runner "${runner}". Use ddev, docker or local.`);
  }

  return {
    command: positionals[0],
    subcommand: positionals[1],
    section: values.section,
    env: values.env,
    config: values.config,
    lockfile: values.lockfile,
    cwd: values.cwd,
    runner,
    verbose: values.verbose ?? false,
    dryRun: values['dry-run'] ?? false,
    fromExisting: values['from-existing'] ?? false,
    check: values.check ?? false,
    prune: values.prune ?? false,
    json: values.json ?? false,
    yes: values.yes ?? false,
    color: !(values['no-color'] ?? false),
    force: values.force ?? false,
    list: values.list ?? false,
    id: values.id,
    out: values.out,
    cms: values.cms,
    siteName: values['site-name'],
    adminEmail: values['admin-email'],
    adminPassword: values['admin-password'],
    php: values.php,
    database: values.database,
    pluginPath: values['plugin-path'],
    from: values.from,
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
    case 'import':
      return runImport(io, {
        root,
        configPath,
        cms: parsed.cms ?? 'craft',
        force: parsed.force,
        from: parsed.from,
        registryFor: registryFor(parsed.runner, verbose),
        ...(registry === undefined ? {} : { registry }),
      });

    case 'new': {
      const knobs: Record<string, string> = {};
      if (parsed.php !== undefined) knobs['php'] = parsed.php;
      if (parsed.database !== undefined) knobs['database'] = parsed.database;
      if (parsed.pluginPath !== undefined) knobs['pluginPath'] = parsed.pluginPath;

      return runNew(io, {
        root,
        configPath,
        lockfilePath,
        cms: parsed.cms ?? 'craft',
        siteName: parsed.siteName,
        adminEmail: parsed.adminEmail,
        adminPassword: parsed.adminPassword,
        knobs,
        registryFor: registryFor(parsed.runner, verbose),
        ...(registry === undefined ? {} : { registry }),
      });
    }

    case 'init':
      return runInit(io, {
        configPath,
        root,
        force: parsed.force,
        cms: parsed.cms,
        siteName: parsed.siteName,
        fromExisting: parsed.fromExisting,
        registryFor: registryFor(parsed.runner, verbose),
        ...(registry === undefined ? {} : { registry }),
      });

    case 'doctor':
      return runDoctor(io, {
        configPath,
        root,
        json: parsed.json,
        registryFor: registryFor(parsed.runner, verbose),
        ...(registry === undefined ? {} : { registry }),
      });

    case 'undo':
      return runUndo(io, {
        configPath,
        root,
        json: parsed.json,
        list: parsed.list,
        id: parsed.id,
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

    case 'sync':
      return runSync(io, {
        configPath,
        lockfilePath,
        root,
        json: parsed.json,
        check: parsed.check,
        prune: parsed.prune,
        registryFor: registryFor(parsed.runner, verbose),
        ...(registry === undefined ? {} : { registry }),
      });

    case 'types':
      return runTypes(io, { configPath, out: parsed.out });

    case 'client':
      return runClient(io, {
        root,
        configPath,
        out: parsed.out,
        envPath: parsed.env,
        registryFor: registryFor(parsed.runner, verbose),
        ...(registry === undefined ? {} : { registry }),
      });

    case 'content': {
      // `content push` — the verb is required, so a bare `luminx content` cannot write anything.
      if (parsed.subcommand !== 'push') {
        throw new UsageError('Usage: luminx content push [--section <handle>] [--from <dir>]');
      }

      return runContentPush(io, {
        root,
        configPath,
        lockfilePath,
        from: parsed.from,
        section: parsed.section,
        dryRun: parsed.dryRun,
        registryFor: registryFor(parsed.runner, verbose),
        ...(registry === undefined ? {} : { registry }),
      });
    }

    case 'plan':
      return runPlan(io, {
        configPath,
        lockfilePath,
        root,
        json: parsed.json,
        out: parsed.out,
        registryFor: registryFor(parsed.runner, verbose),
        ...(registry === undefined ? {} : { registry }),
      });

    default:
      throw new UsageError(`Unknown command: ${parsed.command}`);
  }
};
