import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { emptyLockfile, lookup, readLockfile, writeLockfile } from './lockfile.js';
import type { Lockfile } from './lockfile.js';

const tempFile = async (contents?: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'luminx-lock-'));
  const path = join(dir, 'luminx.lock.json');
  if (contents !== undefined) await writeFile(path, contents, 'utf8');
  return path;
};

const lockfile: Lockfile = {
  version: 1,
  cms: 'memory',
  generatedAt: '2026-07-09T00:00:00.000Z',
  resources: {
    'section:pages': { uid: 'u1', hash: 'sha256:a' },
    'field:title': { uid: 'u2', hash: 'sha256:b' },
  },
};

describe('readLockfile', () => {
  // A first run, not a failure.
  it('returns null when there is no lockfile', async () => {
    const result = await readLockfile(await tempFile());
    expect(result).toEqual({ ok: true, value: null });
  });

  it('reads a valid lockfile', async () => {
    const result = await readLockfile(await tempFile(JSON.stringify(lockfile)));
    expect(result.ok && result.value?.resources['section:pages']).toEqual({
      uid: 'u1',
      hash: 'sha256:a',
    });
  });

  // Treating a corrupt lockfile as absent would drop every UID and turn the next run into a
  // pile of creates against resources that already exist.
  it('fails on a lockfile that exists and does not parse', async () => {
    const result = await readLockfile(await tempFile('{ not json'));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error[0]?.code).toBe('LX1002');
  });

  it('fails on a lockfile with the wrong shape', async () => {
    const result = await readLockfile(await tempFile('{"version":2}'));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error[0]?.code).toBe('LX1003');
  });
});

describe('writeLockfile', () => {
  it('sorts the resource keys, so two developers do not conflict over ordering', async () => {
    const path = await tempFile();
    await writeLockfile(path, lockfile);

    const written = await readFile(path, 'utf8');
    expect(written.indexOf('"field:title"')).toBeLessThan(written.indexOf('"section:pages"'));
    expect(written.endsWith('\n')).toBe(true);
  });

  it('round-trips', async () => {
    const path = await tempFile();
    await writeLockfile(path, lockfile);

    const result = await readLockfile(path);
    expect(result.ok && result.value).toEqual(lockfile);
  });
});

describe('emptyLockfile', () => {
  it('carries the cms and no resources', () => {
    const fresh = emptyLockfile('memory');
    expect(fresh.cms).toBe('memory');
    expect(fresh.resources).toEqual({});
  });

  // generatedAt sits outside everything hashed. Inside, it would make every run differ.
  it('stamps a time, which nothing hashes', () => {
    expect(Date.parse(emptyLockfile('memory').generatedAt)).not.toBeNaN();
  });
});

describe('lookup', () => {
  it('finds an entry, and answers null for anything else', () => {
    expect(lookup(lockfile, 'field:title')?.uid).toBe('u2');
    expect(lookup(lockfile, 'field:absent')).toBeNull();
    expect(lookup(null, 'field:title')).toBeNull();
  });
});
