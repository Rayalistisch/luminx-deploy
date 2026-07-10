import { describe, expect, it } from 'vitest';

import { diffValues } from './changes.js';

describe('diffValues', () => {
  it('finds nothing when the values are equal', () => {
    expect(diffValues({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it('ignores key order, as canonical JSON does', () => {
    expect(diffValues({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
  });

  it('points at the property that changed', () => {
    expect(diffValues({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual([
      { path: '/b', before: 2, after: 3 },
    ]);
  });

  it('recurses into nested objects', () => {
    expect(diffValues({ spec: { max: 60 } }, { spec: { max: 80 } })).toEqual([
      { path: '/spec/max', before: 60, after: 80 },
    ]);
  });

  // An absent property is not a value, and canonicalJson refuses to serialise one. Getting this
  // wrong made the differ throw on the commonest change there is: giving a field a setting.
  it('reports an added and a removed property', () => {
    expect(diffValues({ a: 1 }, { a: 1, b: 2 })).toEqual([
      { path: '/b', before: undefined, after: 2 },
    ]);
    expect(diffValues({ a: 1, b: 2 }, { a: 1 })).toEqual([
      { path: '/b', before: 2, after: undefined },
    ]);
  });

  it('survives the real case: a text field gains a max length', () => {
    expect(diffValues({ spec: { type: 'text' } }, { spec: { type: 'text', max: 60 } })).toEqual([
      { path: '/spec/max', before: undefined, after: 60 },
    ]);
  });

  it('treats two absent properties as equal', () => {
    expect(diffValues({ a: undefined }, {})).toEqual([]);
  });

  // A reordering is one change. Reporting it per index would describe something that did not
  // happen, and order carries meaning everywhere in the IR.
  it('treats an array as one value', () => {
    expect(diffValues({ sources: ['a', 'b'] }, { sources: ['b', 'a'] })).toEqual([
      { path: '/sources', before: ['a', 'b'], after: ['b', 'a'] },
    ]);
  });

  it('reports a change of type at the property, not inside it', () => {
    expect(diffValues({ a: { b: 1 } }, { a: 'text' })).toEqual([
      { path: '/a', before: { b: 1 }, after: 'text' },
    ]);
  });

  it('sorts the changes by pointer, so a plan never depends on key order', () => {
    const changes = diffValues({ z: 1, a: 1 }, { z: 2, a: 2 });
    expect(changes.map((change) => change.path)).toEqual(['/a', '/z']);
  });
});
