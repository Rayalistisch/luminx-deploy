import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConfig, parseConfig } from './loader.js';

const minimal = { version: 1, cms: 'fake' };

/** Narrows without `!`, so a wrong assumption fails the test rather than the type checker. */
const expectErr = <T, E>(result: { ok: true; value: T } | { ok: false; error: E }): E => {
  if (result.ok) throw new Error('expected a failure, got a value');
  return result.error;
};

const expectOk = <T, E>(result: { ok: true; value: T } | { ok: false; error: E }): T => {
  if (!result.ok) throw new Error(`expected a value, got ${JSON.stringify(result.error)}`);
  return result.value;
};

describe('parseConfig', () => {
  it('accepts plain JSON', () => {
    expect(expectOk(parseConfig(JSON.stringify(minimal), 'test'))).toEqual(minimal);
  });

  // The reason §15.1 could settle on JSONC: nothing rewrites the config, so comments survive.
  it('accepts comments and trailing commas', () => {
    const text = `{
      // why this CMS
      "cms": "fake", /* inline */
      "version": 1,
    }`;
    expect(expectOk(parseConfig(text, 'test'))).toEqual(minimal);
  });

  it('reports unparsable text with a line and column', () => {
    const [error] = expectErr(parseConfig('{ "version": }', 'luminx.config.json'));
    expect(error?.code).toBe('LX1002');
    expect(error?.message).toMatch(/1:\d+$/);
    expect(error?.hint).toContain('luminx.config.json');
  });

  it('rejects an unrecognised key rather than ignoring it', () => {
    const [error] = expectErr(parseConfig(JSON.stringify({ ...minimal, maxLevel: 1 }), 'test'));
    expect(error?.code).toBe('LX1003');
    expect(error?.message).toMatch(/maxLevel/);
  });

  it('points at the offending node', () => {
    const config = {
      ...minimal,
      sections: [{ handle: 'pages', type: 'nope', entryTypes: [{ handle: 'a', fields: [] }] }],
    };
    const [error] = expectErr(parseConfig(JSON.stringify(config), 'test'));
    expect(error?.pointer).toBe('/sections/0/type');
  });

  it('reports every schema violation, not just the first', () => {
    const config = { ...minimal, siteName: 1, sites: 'no' };
    expect(expectErr(parseConfig(JSON.stringify(config), 'test')).length).toBeGreaterThan(1);
  });

  it('rejects a handle that is not an identifier', () => {
    const config = { ...minimal, userGroups: [{ handle: 'Editors!', permissions: [] }] };
    const [error] = expectErr(parseConfig(JSON.stringify(config), 'test'));
    expect(error?.pointer).toBe('/userGroups/0/handle');
  });

  // Documented in §3.2 but unimplemented. Silence here would look like it worked.
  it('says `extends` is unsupported instead of calling it a typo', () => {
    const [error] = expectErr(parseConfig(JSON.stringify({ ...minimal, extends: './base' }), 't'));
    expect(error?.pointer).toBe('/extends');
    expect(error?.message).toContain('not supported yet');
  });
});

describe('loadConfig', () => {
  it('reads and validates a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'luminx-'));
    const path = join(dir, 'luminx.config.json');
    await writeFile(path, JSON.stringify(minimal), 'utf8');

    expect(expectOk(await loadConfig(path))).toEqual(minimal);
  });

  it('reports a missing file with a way forward', async () => {
    const [error] = expectErr(await loadConfig(join(tmpdir(), 'luminx-does-not-exist.json')));
    expect(error?.code).toBe('LX1001');
    expect(error?.hint).toContain('luminx init');
  });
});
