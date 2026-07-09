import { describe, expect, it, vi } from 'vitest';

import { all, andThen, err, isErr, isOk, map, mapErr, ok, unwrapOr } from './result.js';

describe('Result', () => {
  it('carries a value on success and an error on failure', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });

  it('narrows with isOk and isErr', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
    expect(isOk(err('boom'))).toBe(false);
    expect(isErr(err('boom'))).toBe(true);
  });

  it('maps the value and leaves the error alone', () => {
    expect(map(ok(2), (n: number) => n * 2)).toEqual(ok(4));

    const fn = vi.fn();
    expect(map(err<string>('boom'), fn)).toEqual(err('boom'));
    expect(fn).not.toHaveBeenCalled();
  });

  it('maps the error and leaves the value alone', () => {
    expect(mapErr(err('boom'), (e: string) => e.length)).toEqual(err(4));

    const fn = vi.fn();
    expect(mapErr(ok(2), fn)).toEqual(ok(2));
    expect(fn).not.toHaveBeenCalled();
  });

  it('chains with andThen, short-circuiting on the first error', () => {
    const double = (n: number) => ok<number>(n * 2);
    expect(andThen(ok(2), double)).toEqual(ok(4));

    const fn = vi.fn();
    expect(andThen(err<string>('boom'), fn)).toEqual(err('boom'));
    expect(fn).not.toHaveBeenCalled();
  });

  it('falls back with unwrapOr', () => {
    expect(unwrapOr(ok(1), 9)).toBe(1);
    expect(unwrapOr(err<string>('boom'), 9)).toBe(9);
  });

  describe('all', () => {
    it('collects every value in order', () => {
      expect(all([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
    });

    it('is ok for an empty list', () => {
      expect(all([])).toEqual(ok([]));
    });

    // Failing fast rather than accumulating: a plan built on a broken resource is not worth
    // validating further, and the first error is the one the user should read.
    it('returns the first error and stops', () => {
      expect(all([ok(1), err('first'), err('second')])).toEqual(err('first'));
    });
  });
});
