import { describe, expect, it } from 'vitest';

import { hashOf } from './hash.js';

describe('hashOf', () => {
  it('is prefixed with the algorithm, so a lockfile survives changing it', () => {
    expect(hashOf({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  // The whole reason hashing goes through canonical JSON rather than JSON.stringify.
  it('ignores key order', () => {
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
  });

  it('respects array order', () => {
    expect(hashOf([1, 2])).not.toBe(hashOf([2, 1]));
  });

  it('separates values that differ', () => {
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: '1' }));
  });

  it('refuses a value with no single JSON form', () => {
    expect(() => hashOf({ when: new Date(0) })).toThrow(TypeError);
  });
});
