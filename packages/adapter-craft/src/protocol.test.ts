import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';

import { PROTOCOL_VERSION } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { EXCHANGE_DIR, createProtocolClient } from './protocol.js';
import type { ExecResult, Runner } from './runner.js';

const tempRoot = () => mkdtemp(join(tmpdir(), 'luminx-proto-'));

/**
 * Reads the paths out of the argv, exactly as the real plugin does: relative to the project root,
 * which is the working directory on both sides of a container boundary.
 */
const pathsFrom = (root: string, args: readonly string[]) => {
  const value = (flag: string) =>
    args.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1) ?? '';

  return {
    request: join(root, value('--requestPath')),
    response: join(root, value('--responsePath')),
  };
};

/** A runner that behaves like the plugin: reads the request, writes an envelope. */
const pluginRunner = (
  root: string,
  reply: (request: unknown) => unknown,
  exec: Partial<ExecResult> = {},
): Runner => ({
  id: 'local',
  describe: (args) => `php craft ${args.join(' ')}`,
  exec: async (args) => {
    const { request, response } = pathsFrom(root, args);
    const payload: unknown = JSON.parse(await readFile(request, 'utf8'));
    const envelope = reply(payload);

    if (envelope !== undefined) await writeFile(response, JSON.stringify(envelope), 'utf8');

    return { code: 0, stdout: '', stderr: '', ...exec };
  },
});

const okEnvelope = (data: unknown) => ({
  protocolVersion: PROTOCOL_VERSION,
  ok: true,
  data,
  errors: [],
  warnings: [],
  diagnostics: { craftVersion: '5.6.0' },
});

describe('protocol client', () => {
  it('sends the protocol version and the action arguments', async () => {
    const root = await tempRoot();
    let seen: unknown;

    const client = createProtocolClient({
      root,
      runner: pluginRunner(root, (request) => {
        seen = request;
        return okEnvelope({ resources: [] });
      }),
    });

    const result = await client.call('luminx/introspect', { kinds: ['section'] });

    expect(result.ok).toBe(true);
    expect(seen).toEqual({ kinds: ['section'], protocolVersion: PROTOCOL_VERSION });
  });

  it('returns the data and the diagnostics', async () => {
    const root = await tempRoot();
    const client = createProtocolClient({
      root,
      runner: pluginRunner(root, () => okEnvelope({ a: 1 })),
    });

    const result = await client.call('luminx/introspect', {});

    expect(result.ok && result.value.data).toEqual({ a: 1 });
    expect(result.ok && result.value.diagnostics).toEqual({ craftVersion: '5.6.0' });
  });

  // `.luminx/` must not accumulate, or it starts to look like state that means something.
  it('removes the exchange files, whatever happened', async () => {
    const root = await tempRoot();
    const client = createProtocolClient({
      root,
      runner: pluginRunner(root, () => okEnvelope(null)),
    });

    await client.call('luminx/introspect', {});
    expect(await readdir(join(root, EXCHANGE_DIR))).toEqual([]);

    // Exit 0 with no response: the client waits, then gives up. Zero here so the test does not.
    const failing = createProtocolClient({
      root,
      runner: pluginRunner(root, () => undefined),
      responseTimeoutMs: 0,
    });
    await failing.call('luminx/introspect', {});
    expect(await readdir(join(root, EXCHANGE_DIR))).toEqual([]);
  });

  // Mutagen syncs a container's writes back to the host asynchronously — one to six seconds,
  // measured against a real DDEV project. Reading at once reports "the plugin wrote no response"
  // for a response the plugin had already written.
  it('waits for a response that arrives late', async () => {
    const root = await tempRoot();
    const runner: Runner = {
      id: 'ddev',
      describe: () => 'ddev exec php craft',
      exec: (args) => {
        const { response } = pathsFrom(root, args);
        // Written after exec returns, exactly as a synced volume delivers it.
        void delay(150).then(() => writeFile(response, JSON.stringify(okEnvelope(1)), 'utf8'));
        return Promise.resolve({ code: 0, stdout: '', stderr: '' });
      },
    };

    const result = await createProtocolClient({ root, runner }).call('luminx/introspect', {});
    expect(result.ok && result.value.data).toBe(1);
  });

  // A plugin Craft has never heard of exits non-zero at once. Waiting thirty seconds to confirm
  // that would be its own kind of wrong.
  it('does not wait when PHP already failed', async () => {
    const root = await tempRoot();
    const started = Date.now();

    const client = createProtocolClient({
      root,
      runner: pluginRunner(root, () => undefined, { code: 1, stderr: 'boom' }),
    });

    await client.call('luminx/introspect', {});
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  // A plugin that is not installed makes Craft say "Unknown command". Reporting a malformed
  // response would send the user looking for a bug that is not there.
  it('recognises a plugin that Craft does not know', async () => {
    const root = await tempRoot();
    const client = createProtocolClient({
      root,
      runner: pluginRunner(root, () => undefined, {
        code: 1,
        stderr: 'Error: Unknown command: luminx',
      }),
    });

    const result = await client.call('luminx/introspect', {});

    expect(!result.ok && result.error.code).toBe('LX2003');
    expect(!result.ok && result.error.hint).toContain('composer require');
  });

  it('reports a missing response, and repeats what PHP said', async () => {
    const root = await tempRoot();
    const client = createProtocolClient({
      root,
      runner: pluginRunner(root, () => undefined, { code: 1, stderr: 'PDOException: no database' }),
    });

    const result = await client.call('luminx/introspect', {});

    expect(!result.ok && result.error.code).toBe('LX3003');
    expect(!result.ok && result.error.hint).toContain('PDOException');
  });

  it('reports a response that is not JSON', async () => {
    const root = await tempRoot();
    const runner: Runner = {
      id: 'local',
      describe: () => 'php craft',
      exec: async (args) => {
        await writeFile(pathsFrom(root, args).response, 'not json', 'utf8');
        return { code: 0, stdout: '', stderr: '' };
      },
    };

    const result = await createProtocolClient({ root, runner }).call('luminx/introspect', {});
    expect(!result.ok && result.error.code).toBe('LX3002');
  });

  // No implicit compatibility, and the advice depends on which side is behind.
  it('refuses a protocol version it does not speak', async () => {
    const root = await tempRoot();

    const newer = createProtocolClient({
      root,
      runner: pluginRunner(root, () => ({ ...okEnvelope(null), protocolVersion: 2 })),
    });
    const older = createProtocolClient({
      root,
      runner: pluginRunner(root, () => ({ ...okEnvelope(null), protocolVersion: 0 })),
    });

    const fromNewer = await newer.call('luminx/introspect', {});
    expect(!fromNewer.ok && fromNewer.error.code).toBe('LX3001');
    expect(!fromNewer.ok && fromNewer.error.hint).toContain('npm install');

    const fromOlder = await older.call('luminx/introspect', {});
    expect(!fromOlder.ok && fromOlder.error.hint).toContain('composer update');
  });

  // The plugin names its own failures with the same closed set of codes (§3.1).
  it('passes the plugin`s error code through', async () => {
    const root = await tempRoot();
    const client = createProtocolClient({
      root,
      runner: pluginRunner(root, () => ({
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        errors: [{ code: 'LX2005', message: 'allowAdminChanges is off', hint: 'Turn it on.' }],
        warnings: [],
        diagnostics: {},
      })),
    });

    const result = await client.call('luminx/introspect', {});

    expect(!result.ok && result.error.code).toBe('LX2005');
    expect(!result.ok && result.error.hint).toBe('Turn it on.');
  });

  it('does not trust a code it has never heard of', async () => {
    const root = await tempRoot();
    const client = createProtocolClient({
      root,
      runner: pluginRunner(root, () => ({
        protocolVersion: PROTOCOL_VERSION,
        ok: false,
        errors: [{ code: 'LX9999', message: 'from the future' }],
        warnings: [],
        diagnostics: {},
      })),
    });

    const result = await client.call('luminx/introspect', {});
    expect(!result.ok && result.error.code).toBe('LX3002');
  });

  it('reports the command it will run, for --verbose', async () => {
    const root = await tempRoot();
    const commands: string[] = [];

    const client = createProtocolClient({
      root,
      runner: pluginRunner(root, () => okEnvelope(null)),
      onCommand: (command) => commands.push(command),
    });

    await client.call('luminx/introspect', {});

    expect(commands[0]).toContain('php craft luminx/introspect --requestPath=');
  });
});
