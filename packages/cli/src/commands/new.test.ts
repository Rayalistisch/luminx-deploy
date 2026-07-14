import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryAdapter, createRegistry } from '@luminx/core';
import type { CmsAdapter } from '@luminx/core';
import { ok } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { parseCli, runCommand } from '../cli.js';
import { ExitCode } from '../exit.js';
import type { Io } from '../io.js';

interface FakeIo extends Io {
  readonly out: () => string;
}

const fakeIo = (): FakeIo => {
  const out: string[] = [];
  return {
    stdout: (text) => void out.push(text),
    stderr: (text) => void out.push(text),
    color: false,
    assumeYes: true,
    ask: (_question, fallback) => Promise.resolve(fallback),
    confirm: () => Promise.resolve(true),
    out: () => out.join(''),
  };
};

/**
 * A CMS that can be stood up, without standing anything up. The memory adapter cannot scaffold —
 * nothing in memory needs to be — so `new` has nothing to talk to unless we give it one.
 */
const scaffoldable = (): CmsAdapter => ({
  ...createMemoryAdapter(),
  scaffold: () => Promise.resolve(ok({ root: '', version: 'test', notes: [] })),
});

const emptyProject = () => mkdtemp(join(tmpdir(), 'luminx-new-'));

/** What `luminx import` leaves behind: a model, and no CMS yet to hold it. */
const imported = {
  version: 1,
  cms: 'memory',
  siteName: 'Imported',
  sections: [
    {
      handle: 'blog',
      name: 'Blog',
      type: 'channel',
      uriFormat: 'blog/{slug}',
      template: 'blog/_entry',
      entryTypes: [
        {
          handle: 'post',
          name: 'Post',
          fields: [{ handle: 'summary', type: 'text', name: 'Summary', required: true }],
        },
      ],
    },
  ],
};

describe('new', () => {
  it('writes a starter model when there is no config, so the first run has something to see', async () => {
    const io = fakeIo();
    const root = await emptyProject();

    const code = await runCommand(
      parseCli(['new', '--yes', '--cms', 'memory']),
      io,
      root,
      createRegistry([scaffoldable()]),
    );

    expect(code).toBe(ExitCode.Success);
    expect(io.out()).toContain('starter content model');

    const written = JSON.parse(await readFile(join(root, 'luminx.config.json'), 'utf8')) as {
      sections: { handle: string }[];
    };
    expect(written.sections[0]?.handle).toBe('pages');
  });

  /**
   * The bug this test exists for.
   *
   * `luminx import` reads an Astro site's content model and writes it to luminx.config.json; `new`
   * then stands a CMS up to hold it. But `new` used to overwrite that config with its starter — so
   * the documented flow threw the user's model away and built a blog nobody asked for, and did it
   * silently. The config a user brought is the reason the CMS is being created at all.
   */
  it('adopts a config that is already there, rather than overwriting it with the starter', async () => {
    const io = fakeIo();
    const root = await emptyProject();
    const configPath = join(root, 'luminx.config.json');
    await writeFile(configPath, JSON.stringify(imported), 'utf8');

    const code = await runCommand(
      parseCli(['new', '--yes', '--cms', 'memory']),
      io,
      root,
      createRegistry([scaffoldable()]),
    );

    expect(code).toBe(ExitCode.Success);

    // The model that was applied is the user's, not the starter's.
    expect(io.out()).toContain('section:blog');
    expect(io.out()).not.toContain('section:pages');

    // And the file itself is untouched.
    const after = JSON.parse(await readFile(configPath, 'utf8')) as { siteName: string };
    expect(after.siteName).toBe('Imported');
  });

  /**
   * The other half of the same real-world failure.
   *
   * `new` built its own pipeline and never ran the capability check that `generate` runs, so a
   * model the CMS could not hold was discovered by the CMS — on the eighth write, with seven
   * resources already created. Every other command refuses this before it touches anything.
   */
  it('refuses a model the CMS cannot hold before it writes anything', async () => {
    const io = fakeIo();
    const root = await emptyProject();
    await writeFile(join(root, 'luminx.config.json'), JSON.stringify(imported), 'utf8');

    const picky: CmsAdapter = {
      ...scaffoldable(),
      capabilities: {
        ...scaffoldable().capabilities,
        // As Craft reserves `title`: the entry has one, so a field may not shadow it.
        reservedFieldHandles: ['summary'],
      },
    };

    const code = await runCommand(
      parseCli(['new', '--yes', '--cms', 'memory']),
      io,
      root,
      createRegistry([picky]),
    );

    expect(code).not.toBe(ExitCode.Success);
    expect(io.out()).toContain('summary');
    // Nothing was applied: the refusal came before the first write.
    expect(io.out()).not.toContain('created');
  });
});
