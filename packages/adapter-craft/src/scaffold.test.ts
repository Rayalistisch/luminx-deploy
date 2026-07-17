import { describe, expect, it } from 'vitest';

import { scaffoldCraft } from './scaffold.js';
import type { ScaffoldExec, ScaffoldExecResult } from './scaffold.js';

/**
 * The scaffolder runs ten commands against Docker, which CI does not have. The exec is injected
 * precisely so the sequence — the thing that actually goes wrong — is testable anyway. What is
 * verified here is order, arguments, and that it stops at the first command that lies.
 */

const ok: ScaffoldExecResult = { code: 0, stdout: '', stderr: '' };

interface Recorder {
  readonly exec: ScaffoldExec;
  readonly commands: () => string[];
}

/** Records every command, and lets a named step fail. */
const recorder = (failOn?: { match: string; result: ScaffoldExecResult }): Recorder => {
  const commands: string[] = [];

  return {
    commands: () => commands,
    exec: (command, args) => {
      const line = `${command} ${args.join(' ')}`;
      commands.push(line);

      return Promise.resolve(
        failOn !== undefined && line.includes(failOn.match) ? failOn.result : ok,
      );
    },
  };
};

const options = {
  root: '/projects/demo',
  siteName: 'Demo',
  admin: { username: 'admin', email: 'a@b.test', password: 'secret' },
};

const empty = () => Promise.resolve([] as readonly string[]);

/** By default the project was created, so the artefact check passes and the run continues. */
const created = () => Promise.resolve(true);

/** Every call needs the same three stubs; this keeps the tests about what they are testing. */
const deps = (
  rec: Recorder,
  over: Partial<{
    listDir: () => Promise<readonly string[]>;
    exists: () => Promise<boolean>;
    copyDir: (from: string, to: string) => Promise<void>;
  }> = {},
) => ({
  exec: rec.exec,
  listDir: over.listDir ?? empty,
  exists: over.exists ?? created,
  copyDir: over.copyDir ?? (() => Promise.resolve()),
});

describe('scaffoldCraft', () => {
  it('runs the whole sequence, in order', async () => {
    const rec = recorder();

    const result = await scaffoldCraft(options, {}, deps(rec));

    expect(result.ok).toBe(true);
    expect(rec.commands()).toEqual([
      'ddev version',
      'ddev config --project-type=craftcms --docroot=web --php-version=8.3 --database=mysql:8.0 --project-name=demo --disable-upload-dirs-warning',
      'ddev start -y',
      'ddev composer create-project -y craftcms/craft:^5',
      'ddev craft install/craft --interactive=0 --username=admin --email=a@b.test --password=secret --site-name=Demo --site-url=https://demo.ddev.site --language=en',
      'ddev composer config allow-plugins.craftcms/plugin-installer true',
      'ddev composer require luminx/craft-luminx:* -W',
      'ddev craft plugin/install luminx',
    ]);
  });

  /**
   * "Already installed" is success, not failure.
   *
   * Craft's composer plugin-installer sometimes enables the plugin during `composer require`, so the
   * explicit `plugin/install` then exits non-zero with "already installed" — and the scaffold used
   * to abort on the last step, after everything actually worked. It must finish.
   */
  it('treats an already-installed plugin as success, not a failed step', async () => {
    const rec = recorder({
      match: 'plugin/install',
      result: { code: 1, stdout: 'LuminX is already installed.', stderr: '' },
    });

    const result = await scaffoldCraft(options, {}, deps(rec));

    expect(result.ok).toBe(true);
  });

  // Any *other* failure of that step is still a real failure.
  it('still fails when the plugin cannot be enabled for a real reason', async () => {
    const rec = recorder({
      match: 'plugin/install',
      result: { code: 1, stdout: '', stderr: 'Plugin not found' },
    });

    const result = await scaffoldCraft(options, {}, deps(rec));

    expect(result.ok).toBe(false);
  });

  // The one mistake nothing in this codebase can undo. Refuse rather than merge into it.
  it('refuses a directory that already has files', async () => {
    const rec = recorder();

    const result = await scaffoldCraft(
      options,
      {},
      deps(rec, { listDir: () => Promise.resolve(['index.html']) }),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toContain('is not empty');
    expect(rec.commands()).toEqual([]); // nothing ran
  });

  it('ignores dotfiles when deciding a directory is empty', async () => {
    const result = await scaffoldCraft(
      options,
      {},
      deps(recorder(), { listDir: () => Promise.resolve(['.git', '.DS_Store']) }),
    );

    expect(result.ok).toBe(true);
  });

  it('says DDEV is missing, rather than failing inside it', async () => {
    const result = await scaffoldCraft(
      options,
      {},
      deps(recorder({ match: 'ddev version', result: { code: 127, stdout: '', stderr: '' } })),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toContain('DDEV is not installed');
    expect(!result.ok && result.error.hint).toContain('ddev.com');
  });

  // Eight commands, and the third failing must not look like the fourth succeeding.
  it('stops at the first command that fails, and says which', async () => {
    const rec = recorder({
      match: 'ddev start',
      result: { code: 1, stdout: '', stderr: 'Docker is not running.' },
    });

    const result = await scaffoldCraft(options, {}, deps(rec));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toContain('Starting containers failed');
    expect(!result.ok && result.error.hint).toContain('Docker is not running');

    // It stopped: nothing after it ran.
    expect(rec.commands().some((c) => c.includes('create-project'))).toBe(false);
  });

  /**
   * The bug that a 39-minute hang and a killed container taught us. Craft's own post-create script
   * runs an interactive `craft install`, which cannot succeed in a scaffolder, so `create-project`
   * reports failure every single time — while producing a perfectly good project. Judging it by
   * its exit code would abort every run there has ever been.
   */
  describe('create-project is judged by what it produced', () => {
    it('carries on when composer reports failure but the project is there', async () => {
      const rec = recorder({
        match: 'create-project',
        result: {
          code: 1,
          stdout: '',
          stderr:
            'Script @php craft install handling the post-create-project-cmd event returned with error code 64',
        },
      });

      const result = await scaffoldCraft(
        options,
        {},
        deps(rec, { exists: () => Promise.resolve(true) }),
      );

      expect(result.ok).toBe(true);
      expect(rec.commands().some((c) => c.includes('install/craft'))).toBe(true);
    });

    it('fails when no project appeared, whatever composer claimed', async () => {
      const rec = recorder();

      const result = await scaffoldCraft(
        options,
        {},
        deps(rec, { exists: () => Promise.resolve(false) }),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.message).toContain('Creating the Craft project failed');
      expect(rec.commands().some((c) => c.includes('install/craft'))).toBe(false);
    });
  });

  it('reports each step as it starts, because this takes minutes', async () => {
    const steps: string[] = [];

    await scaffoldCraft(options, { onStep: (message) => steps.push(message) }, deps(recorder()));

    expect(steps).toContain('Starting containers');
    expect(steps).toContain('Installing Craft');
    expect(steps).toContain('Installing craft-luminx');
  });

  describe('the plugin source', () => {
    // craft-luminx is on Packagist, so a failure here is Composer's to explain — a version clash, a
    // network, a PHP too old. We used to answer every one of them with "it is not published yet",
    // which was true once and then quietly was not. Repeat what Composer said instead of guessing.
    it('passes composer’s own error through when the install fails', async () => {
      const rec = recorder({
        match: 'composer require',
        result: { code: 1, stdout: '', stderr: 'Could not find a matching version' },
      });

      const result = await scaffoldCraft(options, {}, deps(rec));

      expect(!result.ok && result.error.hint).toContain('Could not find a matching version');
    });

    /**
     * The bug a real run found. Composer runs *inside* DDEV, which mounts the project directory and
     * nothing else, so an absolute host path resolves to nothing in there:
     *
     *     The `url` supplied for the path (/Users/…/craft-plugin) repository does not exist
     *
     * A path the container cannot see is not a path. The checkout is copied in, and the repository
     * points at it relatively.
     */
    it('copies the checkout into the project and points at it relatively', async () => {
      const rec = recorder();
      const copies: [string, string][] = [];

      await scaffoldCraft(
        { ...options, options: { pluginPath: '/repo/packages/craft-plugin' } },
        {},
        deps(rec, {
          copyDir: (from, to) => {
            copies.push([from, to]);
            return Promise.resolve();
          },
        }),
      );

      expect(copies).toEqual([
        ['/repo/packages/craft-plugin', '/projects/demo/plugins/craft-luminx'],
      ]);

      // Relative — the container sees the project, not the host.
      expect(rec.commands()).toContain(
        'ddev composer config repositories.luminx path plugins/craft-luminx',
      );
      expect(rec.commands()).not.toContain(
        'ddev composer config repositories.luminx path /repo/packages/craft-plugin',
      );
      expect(rec.commands()).toContain('ddev composer require luminx/craft-luminx:@dev -W');
    });

    it('resolves a relative --plugin-path against the project root before copying', async () => {
      const copies: [string, string][] = [];

      await scaffoldCraft(
        { ...options, options: { pluginPath: '../plugin' } },
        {},
        deps(recorder(), {
          copyDir: (from, to) => {
            copies.push([from, to]);
            return Promise.resolve();
          },
        }),
      );

      expect(copies[0]?.[0]).toBe('/projects/plugin');
    });

    it('says so when the checkout cannot be read', async () => {
      const result = await scaffoldCraft(
        { ...options, options: { pluginPath: '/nope' } },
        {},
        deps(recorder(), { copyDir: () => Promise.reject(new Error('ENOENT: no such directory')) }),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.message).toContain('Could not read the plugin at /nope');
    });
  });

  describe('the knobs', () => {
    it('carries php and database through, since the core never reads them', async () => {
      const rec = recorder();

      await scaffoldCraft(
        { ...options, options: { php: '8.4', database: 'postgres:16' } },
        {},
        deps(rec),
      );

      const config = rec.commands().find((c) => c.includes('ddev config')) ?? '';
      expect(config).toContain('--php-version=8.4');
      expect(config).toContain('--database=postgres:16');
    });

    // DDEV derives a hostname from the project name, so it has to be one.
    it('makes a hostname out of a directory name that is not one', async () => {
      const rec = recorder();

      await scaffoldCraft({ ...options, root: '/projects/My Site (v2)' }, {}, deps(rec));

      expect(rec.commands()[1]).toContain('--project-name=my-site-v2 ');
    });
  });
});
