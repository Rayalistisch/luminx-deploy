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
  const lines: string[] = [];
  return {
    stdout: (t) => void lines.push(t),
    stderr: (t) => void lines.push(t),
    color: false,
    assumeYes: true,
    ask: (_q, fallback) => Promise.resolve(fallback),
    confirm: () => Promise.resolve(true),
    out: () => lines.join(''),
  };
};

/** A CMS that can open a read side, without a CMS to open. */
const readable = (): CmsAdapter => ({
  ...createMemoryAdapter(),
  openReadSide: () =>
    Promise.resolve(
      ok({ endpoint: 'https://cms.example/api', token: 'tok_123', sections: ['blog'] }),
    ),
});

const config = {
  version: 1,
  cms: 'memory',
  siteName: 'Test',
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
          fields: [{ handle: 'summary', type: 'text', name: 'Summary' }],
        },
      ],
    },
  ],
};

const project = async () => {
  const root = await mkdtemp(join(tmpdir(), 'luminx-client-'));
  await writeFile(join(root, 'luminx.config.json'), JSON.stringify(config), 'utf8');
  return root;
};

describe('client', () => {
  /**
   * The output lands in `src/lib/`, which does not exist yet in a fresh project. A bare writeFile
   * then throws ENOENT — which surfaced to a real user as "LX5001, a bug in LuminX" for an ordinary
   * missing folder. Creating the folder is the job, not a surprise.
   */
  it('creates the output directory rather than crashing on a missing one', async () => {
    const root = await project();
    const io = fakeIo();

    const code = await runCommand(
      parseCli(['client', '-o', 'src/lib/luminx.ts', '--env', '.env']),
      io,
      root,
      createRegistry([readable()]),
    );

    expect(code).toBe(ExitCode.Success);

    const client = await readFile(join(root, 'src', 'lib', 'luminx.ts'), 'utf8');
    expect(client).toContain('export const luminx');
  });

  it('writes the endpoint and token to .env, and keeps the token out of the client', async () => {
    const root = await project();
    const io = fakeIo();

    await runCommand(
      parseCli(['client', '-o', 'src/lib/luminx.ts', '--env', '.env']),
      io,
      root,
      createRegistry([readable()]),
    );

    const env = await readFile(join(root, '.env'), 'utf8');
    expect(env).toContain('LUMINX_CMS_URL=https://cms.example/api');
    expect(env).toContain('LUMINX_CMS_TOKEN=tok_123');

    // The token is a secret; it must never be baked into the committed client file.
    const client = await readFile(join(root, 'src', 'lib', 'luminx.ts'), 'utf8');
    expect(client).not.toContain('tok_123');
  });

  it('tells the user plainly when the adapter has no read side', async () => {
    const root = await project();
    const io = fakeIo();

    const code = await runCommand(
      parseCli(['client', '-o', 'src/lib/luminx.ts']),
      io,
      root,
      createRegistry([createMemoryAdapter()]), // no openReadSide
    );

    expect(code).not.toBe(ExitCode.Success);
    expect(io.out()).toContain('no read side');
  });
});
