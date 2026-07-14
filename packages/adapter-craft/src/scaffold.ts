/**
 * `luminx new` for Craft: an empty directory in, a running Craft 5 with your content model out.
 *
 * This is the only code in LuminX that creates a project rather than reconciling one. Everything
 * it does, a developer would otherwise do by hand — configure DDEV, create the Craft project,
 * install it, install the plugin — and every step is one that fails in its own confusing way. The
 * value here is not cleverness; it is that the ten commands run in the right order and stop at the
 * first one that lies.
 *
 * **DDEV is required, and that is a decision, not a limitation.** Standing Craft up without a
 * container means the developer must already have the right PHP, the right extensions, and a
 * database — which is precisely the pain DDEV exists to remove. An adapter that scaffolded onto a
 * bare host would fail on someone's machine in a way we could neither predict nor fix.
 *
 * The exec is injected. Docker is not available in CI, and a scaffolder whose command sequence
 * cannot be tested is a scaffolder nobody can safely change.
 */

import { spawn } from 'node:child_process';
import { access, cp, readdir } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { ErrorCode, err, luminxError, ok } from '@luminx/shared';
import type { LuminxError, Result } from '@luminx/shared';
import type { ScaffoldContext, ScaffoldOptions, ScaffoldResult } from '@luminx/core';

export interface ScaffoldExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a command in a directory. Injected so the whole sequence is testable without Docker. */
export type ScaffoldExec = (
  command: string,
  args: readonly string[],
  cwd: string,
) => Promise<ScaffoldExecResult>;

/**
 * Composer downloading Craft and its dependencies is the slow one, and it is slow in minutes.
 * The ceiling exists so a hang is a failure with a message rather than a terminal that never
 * comes back.
 */
const STEP_TIMEOUT_MS = 20 * 60 * 1000;

export const realExec: ScaffoldExec = (command, args, cwd) =>
  new Promise((resolvePromise, reject) => {
    /**
     * **stdin is `/dev/null`, and that is load-bearing.**
     *
     * Craft's own post-create script runs `craft install`, which prompts. Given an open pipe that
     * nobody will ever write to, it waits for input for ever — measured at 39 minutes with the
     * container idling at 0.02% CPU before it was killed. Given no stdin at all, the prompt reads
     * EOF and the command fails in seconds, which is what a scaffolder needs: a fast, honest no.
     */
    const child = spawn(command, [...args], {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      resolvePromise({
        code: 124,
        stdout,
        stderr: `${stderr}\nTimed out after ${STEP_TIMEOUT_MS / 60_000} minutes.`,
      });
    }, STEP_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));

    child.on('error', (error) => {
      clearTimeout(timer);
      if (!settled) reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (!settled) resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });

const CRAFT_VERSION = '5';
const PLUGIN_PACKAGE = 'luminx/craft-luminx';

/** Where a local plugin checkout is copied to, inside the project the container can see. */
const VENDORED_PLUGIN_DIR = 'plugins/craft-luminx';

/** Never copied: they are the plugin's own build output, and huge. */
const NOT_PLUGIN_SOURCE = ['vendor', 'composer.lock', '.phpunit.cache', 'node_modules'];

const DEFAULTS = {
  php: '8.3',
  database: 'mysql:8.0',
} as const;

/**
 * DDEV derives the site's hostname from the project name, so the directory name has to become
 * one: `My Site (v2)` → `my-site-v2`. Runs of separators collapse, because `my-site--v2` is a
 * legal hostname and an ugly one.
 */
const projectNameFrom = (root: string): string => {
  const base = root.split('/').filter(Boolean).pop() ?? 'luminx';
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return cleaned === '' ? 'luminx' : cleaned;
};

const failed = (step: string, result: ScaffoldExecResult): LuminxError =>
  luminxError(ErrorCode.EnvRunnerNotFound, `${step} failed (exit ${result.code})`, {
    hint: (result.stderr.trim() || result.stdout.trim() || '').split('\n').slice(-3).join('\n'),
  });

export interface CraftScaffoldDeps {
  readonly exec?: ScaffoldExec;
  /** Injected so the empty-directory check is testable. */
  readonly listDir?: (path: string) => Promise<readonly string[]>;
  /** Injected so the "did create-project actually produce a project?" check is testable. */
  readonly exists?: (path: string) => Promise<boolean>;
  /** Injected so vendoring the plugin is testable without touching a disk. */
  readonly copyDir?: (from: string, to: string) => Promise<void>;
}

export const scaffoldCraft = async (
  options: ScaffoldOptions,
  context: ScaffoldContext,
  deps: CraftScaffoldDeps = {},
): Promise<Result<ScaffoldResult, LuminxError>> => {
  const exec = deps.exec ?? realExec;
  const listDir = deps.listDir ?? ((path: string) => readdir(path));
  const exists =
    deps.exists ??
    (async (path: string) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    });
  const copyDir =
    deps.copyDir ??
    ((from: string, to: string) =>
      cp(from, to, {
        recursive: true,
        filter: (source) => !NOT_PLUGIN_SOURCE.some((name) => source.includes(`/${name}`)),
      }));

  const { root, admin } = options;
  const knobs = options.options ?? {};
  const php = knobs['php'] ?? DEFAULTS.php;
  const database = knobs['database'] ?? DEFAULTS.database;
  const pluginPath = knobs['pluginPath'];
  const project = knobs['projectName'] ?? projectNameFrom(root);
  const step = (message: string) => context.onStep?.(message);

  // Creating a project on top of someone's files is the one mistake that cannot be undone by
  // anything in this codebase. Refuse, rather than merge into whatever is there.
  const existing = (await listDir(root)).filter((name) => !name.startsWith('.'));
  if (existing.length > 0) {
    return err(
      luminxError(ErrorCode.EnvRunnerNotFound, `${root} is not empty`, {
        hint: 'Run `luminx new` in an empty directory. It creates a project; it does not adopt one.',
      }),
    );
  }

  // DDEV first: everything after it is pointless without it, and its absence is the likeliest
  // reason this command fails at all.
  const ddev = await exec('ddev', ['version'], root);
  if (ddev.code !== 0) {
    return err(
      luminxError(ErrorCode.EnvRunnerNotFound, 'DDEV is not installed', {
        hint: 'LuminX scaffolds Craft inside DDEV, so the right PHP and database come with it. Install it: https://ddev.com',
      }),
    );
  }

  const run = async (
    label: string,
    command: string,
    args: readonly string[],
  ): Promise<LuminxError | null> => {
    step(label);
    const result = await exec(command, args, root);
    return result.code === 0 ? null : failed(label, result);
  };

  const siteUrl = options.siteUrl ?? `https://${project}.ddev.site`;

  const prepared = await run('Configuring DDEV', 'ddev', [
    'config',
    '--project-type=craftcms',
    '--docroot=web',
    `--php-version=${php}`,
    `--database=${database}`,
    `--project-name=${project}`,
    '--disable-upload-dirs-warning',
  ]);
  if (prepared !== null) return err(prepared);

  const started = await run('Starting containers', 'ddev', ['start', '-y']);
  if (started !== null) return err(started);

  /**
   * **`create-project` is judged by what it produced, not by its exit code.**
   *
   * Craft's own `post-create-project-cmd` ends with `@php craft install`, which is interactive. In
   * a scaffolder there is nobody to answer it, so it fails — every time, by design — and Composer
   * dutifully reports the whole command as failed. The project files are nonetheless there and
   * correct, and `install/craft` below does the install properly a moment later.
   *
   * So a non-zero exit here means nothing on its own. What means something is whether a Craft
   * project now exists. Trusting the exit code would abort every single run; ignoring it blindly
   * would hide a genuine failure. Checking the artefact does neither.
   */
  step('Creating the Craft project');
  const created = await exec(
    'ddev',
    ['composer', 'create-project', '-y', `craftcms/craft:^${CRAFT_VERSION}`],
    root,
  );

  const isProject = await exists(`${root}/composer.json`);

  if (!isProject) {
    return err(
      failed('Creating the Craft project', created.code === 0 ? { ...created, code: 1 } : created),
    );
  }

  const installed = await run('Installing Craft', 'ddev', [
    'craft',
    'install/craft',
    '--interactive=0',
    `--username=${admin.username}`,
    `--email=${admin.email}`,
    `--password=${admin.password}`,
    `--site-name=${options.siteName}`,
    `--site-url=${siteUrl}`,
    '--language=en',
  ]);
  if (installed !== null) return err(installed);

  /**
   * The plugin is how the CLI talks to Craft at all. Until it is on Packagist, a local checkout is
   * the only way in.
   *
   * **A path the container cannot see is not a path.** Composer runs inside DDEV, which mounts the
   * project directory and nothing else, so an absolute host path — the intuitively "safer" choice,
   * and the one this code made first — resolves to nothing at all in there:
   *
   *     The `url` supplied for the path (/Users/…/packages/craft-plugin) repository does not exist
   *
   * So the checkout is copied into the project and the repository points at it relatively. Under a
   * containerised runner, relative-to-the-project is the only kind of path that means anything.
   */
  if (pluginPath !== undefined) {
    const source = isAbsolute(pluginPath) ? pluginPath : resolve(root, pluginPath);

    step('Copying the plugin into the project');
    try {
      await copyDir(source, `${root}/${VENDORED_PLUGIN_DIR}`);
    } catch (error: unknown) {
      return err(
        luminxError(ErrorCode.EnvPluginMissing, `Could not read the plugin at ${source}`, {
          hint: error instanceof Error ? error.message : 'Is --plugin-path correct?',
        }),
      );
    }

    const configured = await run('Pointing Composer at the local plugin', 'ddev', [
      'composer',
      'config',
      'repositories.luminx',
      'path',
      VENDORED_PLUGIN_DIR,
    ]);
    if (configured !== null) return err(configured);
  }

  const allowed = await run('Allowing the Craft plugin installer', 'ddev', [
    'composer',
    'config',
    'allow-plugins.craftcms/plugin-installer',
    'true',
  ]);
  if (allowed !== null) return err(allowed);

  step('Installing craft-luminx');
  const required = await exec(
    'ddev',
    ['composer', 'require', `${PLUGIN_PACKAGE}:${pluginPath === undefined ? '*' : '@dev'}`, '-W'],
    root,
  );

  if (required.code !== 0) {
    return err(
      luminxError(ErrorCode.EnvPluginMissing, `Could not install ${PLUGIN_PACKAGE}`, {
        hint:
          pluginPath === undefined
            ? `${PLUGIN_PACKAGE} is not published yet. Point at a local checkout: --plugin-path <path to packages/craft-plugin>`
            : (required.stderr.trim() || required.stdout.trim()).split('\n').slice(-3).join('\n'),
      }),
    );
  }

  const enabled = await run('Enabling the plugin in Craft', 'ddev', [
    'craft',
    'plugin/install',
    'luminx',
  ]);
  if (enabled !== null) return err(enabled);

  return ok({
    root,
    version: CRAFT_VERSION,
    url: siteUrl,
    notes: [
      `Admin: ${siteUrl}/admin  (${admin.username})`,
      'Describe your content model in luminx.config.json, then run `luminx generate`.',
    ],
  });
};
