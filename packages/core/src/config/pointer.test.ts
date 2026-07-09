import { describe, expect, it } from 'vitest';

import { pointerOf } from './pointer.js';

describe('pointerOf', () => {
  it('joins segments into an RFC 6901 pointer', () => {
    expect(pointerOf(['sections', 0, 'handle'])).toBe('/sections/0/handle');
  });

  it('is the empty string at the root', () => {
    expect(pointerOf([])).toBe('');
  });

  // Unescaped, these would address a different node than the one that failed.
  it('escapes ~ as ~0 and / as ~1', () => {
    expect(pointerOf(['a~b'])).toBe('/a~0b');
    expect(pointerOf(['a/b'])).toBe('/a~1b');
    expect(pointerOf(['~/'])).toBe('/~0~1');
  });
});
