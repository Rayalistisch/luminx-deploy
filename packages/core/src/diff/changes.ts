/**
 * What changed between two values, as JSON pointers into the resource.
 *
 * Arrays are compared whole rather than element by element. `sources: ["a","b"]` becoming
 * `["b","a"]` is one change — a reordering — and reporting it as two would say something false
 * about what happened. Order carries meaning everywhere in the IR, so an array is one value.
 */

import { canonicalJson } from '@luminx/shared';
import type { FieldChange } from '@luminx/shared';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * An absent property is not a value, and `canonicalJson` rightly refuses to serialise one.
 * Adding `max: 60` to a text field would otherwise throw here — the differ compares a spec
 * that has the key against one that does not on nearly every real change.
 */
const equal = (a: unknown, b: unknown): boolean =>
  a === undefined || b === undefined ? a === b : canonicalJson(a) === canonicalJson(b);

const escapeToken = (token: string): string => token.replaceAll('~', '~0').replaceAll('/', '~1');

/** Recurses into objects; treats everything else as an atom. `path` is the pointer so far. */
export const diffValues = (before: unknown, after: unknown, path = ''): readonly FieldChange[] => {
  if (equal(before, after)) return [];

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) =>
      diffValues(before[key], after[key], `${path}/${escapeToken(key)}`),
    );
  }

  return [{ path, before, after }];
};
