import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { probeProject } from './probe.js';

const project = async (files: Readonly<Record<string, string>>): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'luminx-probe-'));

  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, contents, 'utf8');
  }
  return root;
};

describe('probeProject', () => {
  it('reports an empty project without inventing anything', async () => {
    const facts = await probeProject(await project({}));

    expect(facts.composer).toBeNull();
    expect(facts.frameworks).toEqual([]);
    expect(facts.detectedRunners).toEqual([]);
    expect(facts.runner).toBe('local');
    expect(facts.envKeys).toBeNull();
  });

  it('reads composer, package.json, .env and the runner marker together', async () => {
    const root = await project({
      'composer.json': JSON.stringify({
        name: 'acme/site',
        require: { php: '^8.3', 'craftcms/cms': '^5.0' },
      }),
      'composer.lock': JSON.stringify({ packages: [{ name: 'craftcms/cms', version: '5.6.0' }] }),
      'package.json': JSON.stringify({ dependencies: { next: '^15.0.0' } }),
      '.env': 'CRAFT_APP_ID=abc\nDB_PASSWORD=secret\n',
      '.ddev/config.yaml': 'name: acme\n',
    });

    const facts = await probeProject(root);

    expect(facts.composer?.phpConstraint).toBe('^8.3');
    expect(facts.composer?.installed['craftcms/cms']).toBe('5.6.0');
    expect(facts.composer?.lock).toBe('parsed');
    expect(facts.frameworks).toEqual([{ id: 'next', constraint: '^15.0.0' }]);
    expect(facts.runner).toBe('ddev');
    expect(facts.envKeys).toEqual(['CRAFT_APP_ID', 'DB_PASSWORD']);
  });

  // Never the values, not even into a fact object someone might print.
  it('carries env keys but no env values', async () => {
    const facts = await probeProject(await project({ '.env': 'DB_PASSWORD=hunter2\n' }));
    expect(JSON.stringify(facts)).not.toContain('hunter2');
  });

  // "Never installed" is a warning; "the lock file is corrupt" is a failure. A boolean would
  // have told doctor they were the same thing.
  it('distinguishes an absent lock file from an unreadable one', async () => {
    const without = await probeProject(
      await project({ 'composer.json': '{"require":{"php":"^8.3"}}' }),
    );
    expect(without.composer?.lock).toBe('absent');
    expect(without.composer?.installed).toEqual({});

    const broken = await probeProject(
      await project({ 'composer.json': '{"require":{}}', 'composer.lock': 'not json' }),
    );
    expect(broken.composer?.lock).toBe('unreadable');
    expect(broken.composer?.installed).toEqual({});
  });

  it('reports no composer facts when composer.json cannot be parsed', async () => {
    const facts = await probeProject(await project({ 'composer.json': '{ broken' }));
    expect(facts.composer).toBeNull();
  });
});
