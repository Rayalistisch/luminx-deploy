import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { UsageError, parseCli, runCommand } from './cli.js';
import { ExitCode } from './exit.js';
import type { Io } from './io.js';

interface FakeIo extends Io {
  readonly out: () => string;
  readonly err: () => string;
}

const fakeIo = (answers: Readonly<Record<string, string>> = {}): FakeIo => {
  const out: string[] = [];
  const err: string[] = [];

  return {
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
    color: false,
    assumeYes: true,
    ask: (question, fallback) => Promise.resolve(answers[question] ?? fallback),
    confirm: () => Promise.resolve(true),
    out: () => out.join(''),
    err: () => err.join(''),
  };
};

const tempDir = () => mkdtemp(join(tmpdir(), 'luminx-cli-'));

describe('parseCli', () => {
  it('reads a command and its flags', () => {
    const parsed = parseCli(['doctor', '--json', '--config', 'a.json']);
    expect(parsed.command).toBe('doctor');
    expect(parsed.json).toBe(true);
    expect(parsed.config).toBe('a.json');
  });

  it('defaults colour on and turns it off with --no-color', () => {
    expect(parseCli(['doctor']).color).toBe(true);
    expect(parseCli(['doctor', '--no-color']).color).toBe(false);
  });

  it('rejects an unknown flag rather than ignoring it', () => {
    expect(() => parseCli(['doctor', '--bogus'])).toThrow(UsageError);
  });

  it('rejects two commands', () => {
    expect(() => parseCli(['doctor', 'init'])).toThrow(UsageError);
  });
});

describe('runCommand', () => {
  it('prints the version', async () => {
    const io = fakeIo();
    expect(await runCommand(parseCli(['--version']), io, '/')).toBe(ExitCode.Success);
    expect(io.out().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('prints help to stdout and succeeds', async () => {
    const io = fakeIo();
    expect(await runCommand(parseCli(['--help']), io, '/')).toBe(ExitCode.Success);
    expect(io.out()).toContain('Usage');
    expect(io.err()).toBe('');
  });

  // Usage reached by mistake is a diagnostic. On stdout it would corrupt a redirect.
  it('prints usage to stderr and fails when no command is given', async () => {
    const io = fakeIo();
    expect(await runCommand(parseCli([]), io, '/')).toBe(ExitCode.ConfigError);
    expect(io.err()).toContain('Usage');
    expect(io.out()).toBe('');
  });

  it('rejects an unknown command', async () => {
    await expect(runCommand(parseCli(['bogus']), fakeIo(), '/')).rejects.toThrow(UsageError);
  });

  // A pipeline calling a command that does not exist yet must never read success.
  it.each(['generate', 'sync', 'plan', 'undo', 'deploy'])(
    'reserves `%s` and exits non-zero',
    async (command) => {
      const io = fakeIo();
      const code = await runCommand(parseCli([command]), io, '/');
      expect(code).not.toBe(ExitCode.Success);
      expect(io.err()).toMatch(/lands with M\d+|planned for LuminX/);
    },
  );
});

describe('init', () => {
  it('writes a config that doctor then accepts', async () => {
    const cwd = await tempDir();
    const io = fakeIo();

    expect(await runCommand(parseCli(['init', '--yes']), io, cwd)).toBe(ExitCode.Success);

    const written: unknown = JSON.parse(await readFile(join(cwd, 'luminx.config.json'), 'utf8'));
    expect(written).toMatchObject({ version: 1, cms: 'craft' });

    const doctorIo = fakeIo();
    expect(await runCommand(parseCli(['doctor']), doctorIo, cwd)).toBe(ExitCode.Success);
    expect(doctorIo.out()).toContain('Config compiles');
  });

  it('takes the cms and site name from flags', async () => {
    const cwd = await tempDir();
    await runCommand(
      parseCli(['init', '--yes', '--cms', 'fake', '--site-name', 'Demo']),
      fakeIo(),
      cwd,
    );

    const written = JSON.parse(await readFile(join(cwd, 'luminx.config.json'), 'utf8')) as {
      cms: string;
      siteName: string;
    };
    expect(written.cms).toBe('fake');
    expect(written.siteName).toBe('Demo');
  });

  it('refuses to overwrite an existing config', async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, 'luminx.config.json'), '{}', 'utf8');

    const io = fakeIo();
    expect(await runCommand(parseCli(['init', '--yes']), io, cwd)).toBe(ExitCode.ConfigError);
    expect(io.err()).toContain('already exists');
    expect(await readFile(join(cwd, 'luminx.config.json'), 'utf8')).toBe('{}');
  });

  it('overwrites with --force', async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, 'luminx.config.json'), '{}', 'utf8');

    expect(await runCommand(parseCli(['init', '--yes', '--force']), fakeIo(), cwd)).toBe(
      ExitCode.Success,
    );
    expect(await readFile(join(cwd, 'luminx.config.json'), 'utf8')).toContain('"version": 1');
  });
});

describe('doctor', () => {
  it('fails with the config exit code when there is no config', async () => {
    const cwd = await tempDir();
    const io = fakeIo();

    expect(await runCommand(parseCli(['doctor']), io, cwd)).toBe(ExitCode.ConfigError);
    expect(io.err()).toContain('LX1001');
  });

  it('reports a config that does not compile', async () => {
    const cwd = await tempDir();
    await writeFile(
      join(cwd, 'luminx.config.json'),
      JSON.stringify({
        version: 1,
        cms: 'fake',
        sections: [
          {
            handle: 'pages',
            type: 'channel',
            entryTypes: [{ handle: 'a', fields: [{ $ref: '#/fields/nope' }] }],
          },
        ],
      }),
      'utf8',
    );

    const io = fakeIo();
    expect(await runCommand(parseCli(['doctor']), io, cwd)).toBe(ExitCode.ConfigError);
    expect(io.err()).toContain('LX1005');
  });

  it('warns about a pending rename without failing', async () => {
    const cwd = await tempDir();
    await writeFile(
      join(cwd, 'luminx.config.json'),
      JSON.stringify({
        version: 1,
        cms: 'fake',
        sections: [
          {
            handle: 'sitePages',
            previousHandle: 'pages',
            type: 'channel',
            entryTypes: [{ handle: 'a', fields: [] }],
          },
        ],
      }),
      'utf8',
    );

    const io = fakeIo();
    expect(await runCommand(parseCli(['doctor']), io, cwd)).toBe(ExitCode.Success);
    expect(io.out()).toContain('Pending renames');
  });

  it('emits machine-readable checks with --json', async () => {
    const cwd = await tempDir();
    await runCommand(parseCli(['init', '--yes', '--cms', 'fake']), fakeIo(), cwd);

    const io = fakeIo();
    await runCommand(parseCli(['doctor', '--json']), io, cwd);

    const report = JSON.parse(io.out()) as { checks: { id: string }[] };
    expect(report.checks.map((check) => check.id)).toContain('config.compile');
  });

  it('resolves --config relative to --cwd', async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, 'other.json'), JSON.stringify({ version: 1, cms: 'fake' }), 'utf8');

    const io = fakeIo();
    expect(await runCommand(parseCli(['doctor', '--config', 'other.json']), io, cwd)).toBe(
      ExitCode.Success,
    );
    expect(io.out()).toContain('other.json');
  });
});
