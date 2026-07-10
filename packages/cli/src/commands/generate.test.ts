import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compile,
  createMemoryAdapter,
  createRegistry,
  currentModelOf,
  validateConfig,
} from '@luminx/core';
import type { Plan } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { parseCli, runCommand } from '../cli.js';
import { ExitCode } from '../exit.js';
import type { Io } from '../io.js';

interface FakeIo extends Io {
  readonly out: () => string;
  readonly err: () => string;
}

const fakeIo = (): FakeIo => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
    color: false,
    assumeYes: true,
    ask: (_question, fallback) => Promise.resolve(fallback),
    confirm: () => Promise.resolve(true),
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
      entryTypes: [{ handle: 'page', fields: [{ handle: 'title', type: 'text' }] }],
    },
  ],
};

const project = async (contents: unknown = config): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'luminx-gen-'));
  await writeFile(join(root, 'luminx.config.json'), JSON.stringify(contents), 'utf8');
  return root;
};

/** The resources the config compiles to, as a CMS that already holds them would report them. */
const alreadyApplied = () => {
  const parsed = validateConfig(config);
  if (!parsed.ok) throw new Error('fixture rejected');
  const compiled = compile(parsed.value);
  if (!compiled.ok) throw new Error('fixture does not compile');

  const model = currentModelOf([...compiled.value.model.resources.values()]);
  return [...model.resources.values()];
};

describe('generate', () => {
  // Apply lands with M8. Exiting 0 having written nothing would be a lie a pipeline believes.
  it('refuses to run without --dry-run', async () => {
    const io = fakeIo();
    const code = await runCommand(parseCli(['generate']), io, await project());

    expect(code).toBe(ExitCode.ApplyFailed);
    expect(io.err()).toContain('lands with M8');
  });

  it('plans every resource against an empty CMS', async () => {
    const io = fakeIo();
    const code = await runCommand(parseCli(['generate', '--dry-run']), io, await project());

    expect(code).toBe(ExitCode.Success);
    expect(io.out()).toContain('3 resources   3 create');
  });

  // Phases are how the plan is executed, not what it does. The preview says each resource once.
  it('shows a resource once, however many phases it takes', async () => {
    const io = fakeIo();
    await runCommand(parseCli(['generate', '--dry-run']), io, await project());

    const sectionLines = io
      .out()
      .split('\n')
      .filter((line) => line.includes('section'));
    expect(sectionLines).toHaveLength(1);
    expect(io.out()).toContain('5 operations across two phases');
  });

  // The most important behaviour in the project (§13). Against a CMS that already matches,
  // a plan must contain skips and nothing else.
  it('plans nothing but skips when the CMS already matches', async () => {
    const io = fakeIo();
    const registry = createRegistry([createMemoryAdapter({ initial: alreadyApplied() })]);

    const code = await runCommand(
      parseCli(['generate', '--dry-run']),
      io,
      await project(),
      registry,
    );

    expect(code).toBe(ExitCode.Success);
    expect(io.out()).toContain('0 create   0 update   3 skip   0 delete');
  });

  it('emits the plan as JSON, with the hashes it was computed from', async () => {
    const io = fakeIo();
    await runCommand(parseCli(['generate', '--dry-run', '--json']), io, await project());

    const plan = JSON.parse(io.out()) as Plan;
    expect(plan.version).toBe(1);
    expect(plan.cms).toBe('memory');
    expect(plan.sourceHash).toMatch(/^sha256:/);
    expect(plan.baseHash).toMatch(/^sha256:/);
  });

  it('reports an unknown cms rather than planning against nothing', async () => {
    const io = fakeIo();
    const root = await project({ ...config, cms: 'nosuchcms' });

    const code = await runCommand(parseCli(['generate', '--dry-run']), io, root);

    expect(code).toBe(ExitCode.EnvironmentError);
    expect(io.err()).toContain('LX2002');
    expect(io.err()).toContain('memory');
  });

  // §7.1: unsupported field types fail before a plan exists, not halfway through an apply.
  it('rejects a field type the adapter cannot express, before planning', async () => {
    const io = fakeIo();
    const registry = createRegistry([
      createMemoryAdapter({ capabilities: { fieldTypes: ['richtext'], resourceKinds: ['field'] } }),
    ]);

    const code = await runCommand(
      parseCli(['generate', '--dry-run']),
      io,
      await project(),
      registry,
    );

    expect(code).toBe(ExitCode.ConfigError);
    expect(io.err()).toContain('LX1007');
  });

  it('fails on a corrupt lockfile instead of treating it as absent', async () => {
    const root = await project();
    await writeFile(join(root, 'luminx.lock.json'), '{ not json', 'utf8');

    const io = fakeIo();
    const code = await runCommand(parseCli(['generate', '--dry-run']), io, root);

    expect(code).toBe(ExitCode.ConfigError);
    expect(io.err()).toContain('LX1002');
  });

  it('reports config errors without ever resolving an adapter', async () => {
    const io = fakeIo();
    const root = await project({
      version: 1,
      cms: 'nosuchcms',
      sections: [
        {
          handle: 'pages',
          type: 'channel',
          entryTypes: [{ handle: 'a', fields: [{ $ref: '#/fields/ghost' }] }],
        },
      ],
    });

    // The config is broken *and* the cms is unknown. Compilation runs first, so the user is
    // told about the thing they can fix rather than about an adapter they never asked for.
    const code = await runCommand(parseCli(['generate', '--dry-run']), io, root);

    expect(code).toBe(ExitCode.ConfigError);
    expect(io.err()).toContain('LX1005');
    expect(io.err()).not.toContain('LX2002');
  });
});
