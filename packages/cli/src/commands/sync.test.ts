import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compile,
  createMemoryAdapter,
  createRegistry,
  currentModelOf,
  validateConfig,
} from '@luminx/core';
import type { CurrentResource } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { parseCli, runCommand } from '../cli.js';
import { ExitCode } from '../exit.js';
import type { Io } from '../io.js';

interface FakeIo extends Io {
  readonly out: () => string;
  readonly err: () => string;
}

const fakeIo = (confirm = true): FakeIo => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
    color: false,
    assumeYes: true,
    ask: (_q, fallback) => Promise.resolve(fallback),
    confirm: () => Promise.resolve(confirm),
    out: () => out.join(''),
    err: () => err.join(''),
  };
};

const config = {
  version: 1,
  cms: 'memory',
  sections: [
    {
      handle: 'pages',
      type: 'channel',
      entryTypes: [{ handle: 'page', fields: [{ handle: 'heading', type: 'text', max: 60 }] }],
    },
  ],
};

const project = async (contents: unknown = config): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'luminx-sync-'));
  await writeFile(join(root, 'luminx.config.json'), JSON.stringify(contents), 'utf8');
  return root;
};

/** The resources a config compiles to, as a CMS that already holds them would report them. */
const applied = (contents: unknown = config): CurrentResource[] => {
  const parsed = validateConfig(contents);
  if (!parsed.ok) throw new Error('fixture rejected');
  const model = compile(parsed.value);
  if (!model.ok) throw new Error('fixture does not compile');
  return [...currentModelOf([...model.value.model.resources.values()]).resources.values()];
};

const lockfileFor = (root: string, resources: CurrentResource[]) =>
  writeFile(
    join(root, 'luminx.lock.json'),
    JSON.stringify({
      version: 1,
      cms: 'memory',
      generatedAt: '1970-01-01T00:00:00.000Z',
      resources: Object.fromEntries(
        resources.map((r) => [r.resource.logicalId, { uid: r.uid, hash: r.resource.hash }]),
      ),
    }),
    'utf8',
  );

describe('sync --check', () => {
  // The pipeline gate: identical means 0, diverged means 1 — a signal, not a failure (§8.6).
  it('exits 0 when the CMS matches the config', async () => {
    const registry = createRegistry([createMemoryAdapter({ initial: applied() })]);
    const io = fakeIo();

    const code = await runCommand(parseCli(['sync', '--check']), io, await project(), registry);

    expect(code).toBe(ExitCode.Success);
    expect(io.out()).toContain('matches the config');
  });

  it('exits 1 when the CMS is missing something the config has', async () => {
    const registry = createRegistry([createMemoryAdapter()]); // empty CMS
    const io = fakeIo();

    const code = await runCommand(parseCli(['sync', '--check']), io, await project(), registry);

    expect(code).toBe(ExitCode.ChangesDetected);
    expect(io.out()).toContain('diverged');
  });

  // §8.5: check never writes, whatever it finds.
  it('writes nothing, even when it finds divergence', async () => {
    const adapter = createMemoryAdapter();
    const registry = createRegistry([adapter]);
    const root = await project();

    await runCommand(parseCli(['sync', '--check']), fakeIo(), root, registry);

    const after = await adapter.introspect({ root, facts: {} as never });
    expect(after.ok && after.value.resources.size).toBe(0);
  });
});

describe('sync drift', () => {
  // §5.3: config unchanged, CMS changed. Reported, and enough on its own to fail --check.
  it('reports a resource changed in the CMS but not the config', async () => {
    const root = await project();

    // The lockfile says the config as-is was the last apply...
    await lockfileFor(root, applied());
    // ...but the CMS now holds a different version of one field.
    const drifted = applied({
      ...config,
      sections: [
        {
          handle: 'pages',
          type: 'channel',
          entryTypes: [{ handle: 'page', fields: [{ handle: 'heading', type: 'text', max: 999 }] }],
        },
      ],
    });
    const registry = createRegistry([createMemoryAdapter({ initial: drifted })]);

    const io = fakeIo();
    const code = await runCommand(parseCli(['sync', '--check']), io, root, registry);

    expect(io.out()).toContain('Drift');
    expect(io.out()).toContain('heading');
    expect(code).toBe(ExitCode.ChangesDetected);
  });
});

describe('sync --prune', () => {
  const withBlog = {
    ...config,
    sections: [
      config.sections[0],
      { handle: 'blog', type: 'channel', entryTypes: [{ handle: 'post', fields: [] }] },
    ],
  };

  // §8.2: a resource left out of the config is orphaned, and only --prune deletes it.
  it('deletes what the config no longer describes, once confirmed', async () => {
    const adapter = createMemoryAdapter({ initial: applied(withBlog) });
    const registry = createRegistry([adapter]);
    const root = await project(); // config has pages only; the CMS also has blog

    const io = fakeIo();
    const code = await runCommand(parseCli(['sync', '--prune']), io, root, registry);

    expect(code).toBe(ExitCode.Success);
    expect(io.out()).toContain('deleted');

    const after = await adapter.introspect({ root, facts: {} as never });
    expect(after.ok && after.value.resources.has('section:blog')).toBe(false);
    expect(after.ok && after.value.resources.has('section:pages')).toBe(true);
  });

  it('deletes nothing when the prune is declined', async () => {
    const adapter = createMemoryAdapter({ initial: applied(withBlog) });
    const registry = createRegistry([adapter]);
    const root = await project();

    const code = await runCommand(parseCli(['sync', '--prune']), fakeIo(false), root, registry);

    expect(code).toBe(ExitCode.Success);
    const after = await adapter.introspect({ root, facts: {} as never });
    expect(after.ok && after.value.resources.has('section:blog')).toBe(true);
  });

  // Without --prune an orphan is reported, never removed.
  it('leaves orphans untouched without --prune', async () => {
    const adapter = createMemoryAdapter({ initial: applied(withBlog) });
    const registry = createRegistry([adapter]);
    const root = await project();

    await runCommand(parseCli(['sync']), fakeIo(), root, registry);

    const after = await adapter.introspect({ root, facts: {} as never });
    expect(after.ok && after.value.resources.has('section:blog')).toBe(true);
  });
});

describe('sync', () => {
  it('reports nothing to do when everything matches', async () => {
    const registry = createRegistry([createMemoryAdapter({ initial: applied() })]);
    const io = fakeIo();

    const code = await runCommand(parseCli(['sync']), io, await project(), registry);

    expect(code).toBe(ExitCode.Success);
    expect(io.out()).toContain('Nothing to do');
  });

  it('applies additively, like generate, when confirmed', async () => {
    const registry = createRegistry([createMemoryAdapter()]);
    const root = await project();

    const io = fakeIo();
    await runCommand(parseCli(['sync']), io, root, registry);

    expect(io.out()).toContain('Applied');
    const lockfile = JSON.parse(await readFile(join(root, 'luminx.lock.json'), 'utf8')) as {
      resources: Record<string, unknown>;
    };
    expect(Object.keys(lockfile.resources)).toContain('section:pages');
  });
});
