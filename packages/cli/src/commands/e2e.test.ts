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

/**
 * The end-to-end tests §14 calls M11's point, run against the in-memory adapter so they live in CI
 * with no PHP and no CMS:
 *
 *   - init → generate → generate, where the second generate must be all skips (idempotency, §13);
 *   - init --from-existing against a populated CMS, whose config must round-trip to zero changes.
 *
 * These are the two invariants the whole design rests on, guarded on every push.
 */

interface FakeIo extends Io {
  readonly out: () => string;
}

const fakeIo = (): FakeIo => {
  const out: string[] = [];
  return {
    stdout: (text) => void out.push(text),
    stderr: () => {},
    color: false,
    assumeYes: true,
    ask: (_q, fallback) => Promise.resolve(fallback),
    confirm: () => Promise.resolve(true),
    out: () => out.join(''),
  };
};

/** A content model exercising every reference shape: relations, a matrix, the mutual cycle. */
const fullConfig = {
  version: 1,
  cms: 'memory',
  filesystems: [{ handle: 'local', name: 'Local', type: 'local', path: '@webroot/uploads' }],
  volumes: [{ handle: 'images', name: 'Images', fs: 'local' }],
  fields: {
    heading: { type: 'text', name: 'Heading', max: 120 },
    hero: { type: 'assets', name: 'Hero', sources: ['images'], maxRelations: 1 },
    related: { type: 'entries', name: 'Related', sources: ['blog'] },
    body: { type: 'matrix', name: 'Body', entryTypes: [{ $ref: '#/entryTypes/text' }] },
  },
  entryTypes: {
    text: { name: 'Text', fields: [{ handle: 'copy', type: 'text' }] },
    page: {
      name: 'Page',
      fields: [
        { $ref: '#/fields/heading', required: true },
        { $ref: '#/fields/hero' },
        { $ref: '#/fields/body' },
        { $ref: '#/fields/related' },
      ],
    },
    post: { name: 'Post', fields: [{ $ref: '#/fields/heading', required: true }] },
  },
  sections: [
    {
      handle: 'pages',
      name: 'Pages',
      type: 'structure',
      maxLevels: 3,
      entryTypes: [{ $ref: '#/entryTypes/page' }],
    },
    { handle: 'blog', name: 'Blog', type: 'channel', entryTypes: [{ $ref: '#/entryTypes/post' }] },
  ],
  categories: [{ handle: 'topics', name: 'Topics', maxLevels: 1 }],
  userGroups: [{ handle: 'editors', name: 'Editors', permissions: [] }],
};

const project = async (contents: unknown): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'luminx-e2e-'));
  await writeFile(join(root, 'luminx.config.json'), JSON.stringify(contents), 'utf8');
  return root;
};

const applied = (contents: unknown): CurrentResource[] => {
  const parsed = validateConfig(contents);
  if (!parsed.ok) throw new Error('fixture rejected');
  const model = compile(parsed.value);
  if (!model.ok) throw new Error('fixture does not compile');
  return [...currentModelOf([...model.value.model.resources.values()]).resources.values()];
};

describe('e2e: generate is idempotent', () => {
  // The most important test in the project (§13). The second generate must do nothing.
  it('applies a full model, then a second run is all skips', async () => {
    const registry = createRegistry([createMemoryAdapter()]);
    const root = await project(fullConfig);

    const first = fakeIo();
    expect(await runCommand(parseCli(['generate', '--yes']), first, root, registry)).toBe(
      ExitCode.Success,
    );
    expect(first.out()).toContain('Applied');

    const second = fakeIo();
    expect(await runCommand(parseCli(['generate', '--yes']), second, root, registry)).toBe(
      ExitCode.Success,
    );
    // Every resource a skip, nothing applied. The summary line always names create/update, so
    // the signal is the counts and "Nothing to do", not the mere absence of those words.
    expect(second.out()).toContain('0 create   0 update');
    expect(second.out()).toContain('Nothing to do');
    expect(second.out()).not.toContain('Applied');
  });

  it('and sync --check agrees the CMS matches', async () => {
    const registry = createRegistry([createMemoryAdapter({ initial: applied(fullConfig) })]);
    const root = await project(fullConfig);

    expect(await runCommand(parseCli(['sync', '--check']), fakeIo(), root, registry)).toBe(
      ExitCode.Success,
    );
  });
});

describe('e2e: init --from-existing round-trips', () => {
  // §14: introspect a populated CMS, write the config, and the first generate against it must be
  // a noop. Anything else is an introspection gap, and this is where it would show.
  it('writes a config that generate then reports nothing to do against', async () => {
    const registry = createRegistry([createMemoryAdapter({ initial: applied(fullConfig) })]);
    const root = await mkdtemp(join(tmpdir(), 'luminx-e2e-')); // no config yet

    const init = fakeIo();
    const code = await runCommand(
      parseCli(['init', '--from-existing', '--cms', 'memory']),
      init,
      root,
      registry,
    );

    expect(code).toBe(ExitCode.Success);
    expect(init.out()).toContain('Read');
    expect(init.out()).not.toContain('does not fully round-trip');

    // The written config describes the CMS: generate against the same CMS changes nothing.
    const generate = fakeIo();
    expect(await runCommand(parseCli(['generate', '--yes']), generate, root, registry)).toBe(
      ExitCode.Success,
    );
    expect(generate.out()).toContain('Nothing to do');
  });

  it('reproduces every resource kind in the written file', async () => {
    const registry = createRegistry([createMemoryAdapter({ initial: applied(fullConfig) })]);
    const root = await mkdtemp(join(tmpdir(), 'luminx-e2e-'));

    await runCommand(
      parseCli(['init', '--from-existing', '--cms', 'memory']),
      fakeIo(),
      root,
      registry,
    );

    const written = JSON.parse(await readFile(join(root, 'luminx.config.json'), 'utf8')) as Record<
      string,
      unknown
    >;

    for (const key of [
      'fields',
      'entryTypes',
      'filesystems',
      'volumes',
      'sections',
      'categories',
      'userGroups',
    ]) {
      expect(written[key], `expected ${key} in the generated config`).toBeDefined();
    }
  });
});
