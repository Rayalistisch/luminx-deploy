import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryAdapter, createRegistry } from '@luminx/core';
import type { Plan } from '@luminx/shared';
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
    stderr: () => {},
    color: false,
    assumeYes: true,
    ask: (_q, fallback) => Promise.resolve(fallback),
    confirm: () => Promise.resolve(true),
    out: () => out.join(''),
  };
};

const config = {
  version: 1,
  cms: 'memory',
  sections: [
    {
      handle: 'pages',
      type: 'channel',
      entryTypes: [{ handle: 'page', fields: [{ handle: 'heading', type: 'text' }] }],
    },
  ],
};

const project = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'luminx-plan-'));
  await writeFile(join(root, 'luminx.config.json'), JSON.stringify(config), 'utf8');
  return root;
};

describe('plan', () => {
  const registry = () => createRegistry([createMemoryAdapter()]);

  // §11.2: the plan is the deploy input. It carries the hashes that let deploy refuse to apply
  // against a CMS that has moved on since the plan was made.
  it('writes a plan.json with the hashes deploy needs', async () => {
    const root = await project();
    const out = join(root, 'plan.json');

    const io = fakeIo();
    const code = await runCommand(parseCli(['plan', '-o', out]), io, root, registry());

    expect(code).toBe(ExitCode.Success);
    expect(io.out()).toContain('Wrote');

    const plan = JSON.parse(await readFile(out, 'utf8')) as Plan;
    expect(plan.version).toBe(1);
    expect(plan.cms).toBe('memory');
    expect(plan.sourceHash).toMatch(/^sha256:/);
    expect(plan.baseHash).toMatch(/^sha256:/);
    expect(plan.operations.length).toBeGreaterThan(0);
  });

  it('is a reviewable artefact: the same config writes the same bytes', async () => {
    const root = await project();
    const a = join(root, 'a.json');
    const b = join(root, 'b.json');

    await runCommand(parseCli(['plan', '-o', a]), fakeIo(), root, registry());
    await runCommand(parseCli(['plan', '-o', b]), fakeIo(), root, registry());

    expect(await readFile(a, 'utf8')).toBe(await readFile(b, 'utf8'));
  });

  it('streams the plan to stdout with --json and no -o', async () => {
    const io = fakeIo();
    await runCommand(parseCli(['plan', '--json']), io, await project(), registry());

    const plan = JSON.parse(io.out()) as Plan;
    expect(plan.cms).toBe('memory');
  });

  it('writes nothing and reports the config error when the config is broken', async () => {
    const root = await mkdtemp(join(tmpdir(), 'luminx-plan-'));
    await writeFile(join(root, 'luminx.config.json'), '{ not json', 'utf8');

    const code = await runCommand(
      parseCli(['plan', '-o', join(root, 'p.json')]),
      fakeIo(),
      root,
      registry(),
    );
    expect(code).toBe(ExitCode.ConfigError);
  });
});
