import { describe, expect, it } from 'vitest';

import { detectFrameworks, parsePackageJson } from './frontend.js';

const pkg = (dependencies: Record<string, string>, devDependencies: Record<string, string> = {}) =>
  ({ name: 'demo', dependencies, devDependencies }) as const;

describe('parsePackageJson', () => {
  it('reads dependencies and devDependencies', () => {
    const parsed = parsePackageJson(
      '{"name":"a","dependencies":{"next":"^15"},"devDependencies":{"vite":"^6"}}',
    );
    expect(parsed).toEqual({
      name: 'a',
      dependencies: { next: '^15' },
      devDependencies: { vite: '^6' },
    });
  });

  it('returns null for text it cannot parse', () => {
    expect(parsePackageJson('{')).toBeNull();
  });

  it('treats missing dependency blocks as empty', () => {
    expect(parsePackageJson('{}')).toEqual({ name: null, dependencies: {}, devDependencies: {} });
  });
});

describe('detectFrameworks', () => {
  it('finds a framework and keeps its constraint verbatim', () => {
    expect(detectFrameworks(pkg({ next: '^15.0.0' }))).toEqual([
      { id: 'next', constraint: '^15.0.0' },
    ]);
  });

  it('looks in devDependencies too', () => {
    expect(detectFrameworks(pkg({}, { astro: '^5' }))).toEqual([{ id: 'astro', constraint: '^5' }]);
  });

  it('prefers the dependency entry when a package appears in both', () => {
    expect(detectFrameworks(pkg({ nuxt: '^4' }, { nuxt: '^3' }))).toEqual([
      { id: 'nuxt', constraint: '^4' },
    ]);
  });

  it('finds none in a project that has none', () => {
    expect(detectFrameworks(pkg({ lodash: '^4' }))).toEqual([]);
  });

  // §3.3 forbids guessing. Two frameworks is a fact; choosing between them is the caller's job.
  it('reports every framework it finds rather than picking one', () => {
    expect(detectFrameworks(pkg({ next: '^15', astro: '^5' }))).toEqual([
      { id: 'next', constraint: '^15' },
      { id: 'astro', constraint: '^5' },
    ]);
  });
});
