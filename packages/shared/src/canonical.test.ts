import { describe, expect, it } from 'vitest';

import { canonicalJson } from './canonical.js';

describe('canonicalJson', () => {
  it('is independent of key insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts keys at every depth', () => {
    expect(canonicalJson({ z: { y: 1, x: 2 }, a: 3 })).toBe('{"a":3,"z":{"x":2,"y":1}}');
  });

  it('sorts by UTF-16 code unit, so uppercase precedes lowercase', () => {
    expect(canonicalJson({ a: 1, B: 2 })).toBe('{"B":2,"a":1}');
  });

  it('preserves array order, which carries meaning', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('omits undefined properties and renders undefined elements as null', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson([1, undefined, 2])).toBe('[1,null,2]');
  });

  it('collapses -0 to 0 so they cannot hash apart', () => {
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson(-0)).toBe(canonicalJson(0));
  });

  it('escapes strings exactly as JSON does', () => {
    expect(canonicalJson('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
    expect(canonicalJson('é☃')).toBe('"é☃"');
  });

  it('handles null, booleans and nesting', () => {
    expect(canonicalJson({ n: null, t: true, f: false, nested: [{ a: 1 }] })).toBe(
      '{"f":false,"n":null,"nested":[{"a":1}],"t":true}',
    );
  });

  // Each of these has a JSON form that loses information. Silently accepting one would make
  // two different specs hash the same, which is the one bug determinism cannot survive.
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s rather than emitting null', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it.each([
    ['a Date', new Date(0)],
    ['a Map', new Map([['a', 1]])],
    ['a Set', new Set([1])],
    ['a class instance', new (class Point {})()],
  ])('rejects %s, which JSON.stringify would flatten or invent', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it.each([
    ['undefined', undefined],
    ['a bigint', 1n],
    ['a symbol', Symbol('s')],
    ['a function', () => 1],
  ])('rejects %s, which has no JSON form at all', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it('accepts a null-prototype object as plain', () => {
    const bare = Object.assign(Object.create(null) as object, { b: 1, a: 2 });
    expect(canonicalJson(bare)).toBe('{"a":2,"b":1}');
  });

  it('is stable across repeated calls, which is the whole contract', () => {
    const spec = { type: 'matrix', entryTypes: ['entryType:hero', 'entryType:faq'], maxEntries: 3 };
    const first = canonicalJson(spec);
    for (let i = 0; i < 100; i++) expect(canonicalJson(spec)).toBe(first);
  });
});
