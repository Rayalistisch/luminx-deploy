import { describe, expect, it } from 'vitest';

import { normalizeVersion, parseComposerJson, parseComposerLock } from './composer.js';

describe('parseComposerJson', () => {
  it('reads the name, the php constraint and the requirements', () => {
    const json = parseComposerJson(
      JSON.stringify({
        name: 'acme/site',
        require: { php: '^8.3', 'craftcms/cms': '^5.0' },
        'require-dev': { 'craftcms/generator': '^2.0' },
      }),
    );

    expect(json).toEqual({
      name: 'acme/site',
      php: '^8.3',
      require: { php: '^8.3', 'craftcms/cms': '^5.0' },
      requireDev: { 'craftcms/generator': '^2.0' },
    });
  });

  it('reports a missing php constraint as null, not as a default', () => {
    expect(parseComposerJson('{"require":{}}')?.php).toBeNull();
  });

  it('returns null for text it cannot parse', () => {
    expect(parseComposerJson('{ not json')).toBeNull();
  });

  // "Could not read it" and "it says nothing" are different answers, and only one is a fact.
  it('returns null for JSON that is not an object', () => {
    expect(parseComposerJson('[]')).toBeNull();
    expect(parseComposerJson('"text"')).toBeNull();
  });

  it('ignores requirement entries that are not strings', () => {
    expect(parseComposerJson('{"require":{"php":"^8.3","weird":{"a":1}}}')?.require).toEqual({
      php: '^8.3',
    });
  });
});

describe('parseComposerLock', () => {
  it('collects exact versions from packages and packages-dev', () => {
    const lock = parseComposerLock(
      JSON.stringify({
        packages: [{ name: 'craftcms/cms', version: '5.6.0' }],
        'packages-dev': [{ name: 'phpunit/phpunit', version: '11.0.1' }],
      }),
    );

    expect(lock?.installed).toEqual({ 'craftcms/cms': '5.6.0', 'phpunit/phpunit': '11.0.1' });
  });

  it('is empty, not null, for a lock file with no packages', () => {
    expect(parseComposerLock('{}')?.installed).toEqual({});
  });

  it('skips entries missing a name or a version', () => {
    const lock = parseComposerLock(
      '{"packages":[{"name":"a"},{"version":"1.0"},{"name":"b","version":"2.0"}]}',
    );
    expect(lock?.installed).toEqual({ b: '2.0' });
  });

  it('returns null for text it cannot parse', () => {
    expect(parseComposerLock('nope')).toBeNull();
  });
});

describe('normalizeVersion', () => {
  it('strips the leading v Composer sometimes writes', () => {
    expect(normalizeVersion('v5.6.0')).toBe('5.6.0');
    expect(normalizeVersion('5.6.0')).toBe('5.6.0');
  });
});
