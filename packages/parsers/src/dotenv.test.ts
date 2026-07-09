import { describe, expect, it } from 'vitest';

import { parseDotEnvKeys } from './dotenv.js';

describe('parseDotEnvKeys', () => {
  it('returns the keys, sorted', () => {
    expect(parseDotEnvKeys('DB_USER=root\nAPP_ID=abc\n')).toEqual(['APP_ID', 'DB_USER']);
  });

  it('understands `export` and spaces around the equals sign', () => {
    expect(parseDotEnvKeys('export FOO=1\nBAR = 2\n  BAZ=3')).toEqual(['BAR', 'BAZ', 'FOO']);
  });

  it('ignores comments and blank lines', () => {
    expect(parseDotEnvKeys('# DB_PASSWORD=secret\n\n  # note\nFOO=1')).toEqual(['FOO']);
  });

  it('ignores lines with no assignment', () => {
    expect(parseDotEnvKeys('JUST_A_WORD\nFOO=1')).toEqual(['FOO']);
  });

  it('reports a key only once', () => {
    expect(parseDotEnvKeys('FOO=1\nFOO=2')).toEqual(['FOO']);
  });

  // §3.3: presence of keys, never values. The whole point of the parser.
  it('never returns a value, even one that looks like a key', () => {
    const keys = parseDotEnvKeys('DB_PASSWORD=hunter2\nSECRET=OTHER_KEY=nested');
    expect(keys).toEqual(['DB_PASSWORD', 'SECRET']);
    expect(JSON.stringify(keys)).not.toContain('hunter2');
    expect(JSON.stringify(keys)).not.toContain('nested');
  });
});
