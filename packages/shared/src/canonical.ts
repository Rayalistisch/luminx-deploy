/**
 * Canonical JSON: one value, exactly one byte sequence. Every hash in LuminX is taken over
 * this output, so a resource that did not change must serialise identically today, tomorrow,
 * and on someone else's machine. See docs/architecture.md §13.
 *
 * Object keys are sorted by UTF-16 code unit, which is what `Array.prototype.sort` does by
 * default and what RFC 8785 prescribes.
 *
 * This function is deliberately narrow. It rejects every value whose JSON form is ambiguous
 * or environment-dependent rather than quietly picking one:
 *
 * - `Date` — serialising it would bake a timezone-free instant into a hash and invite
 *   `new Date()` into hashed data. Callers format their own strings.
 * - `NaN`, `Infinity` — `JSON.stringify` turns these into `null`, so two different specs
 *   would hash the same.
 * - `Map`, `Set`, class instances — iteration order is a property of the object, not of its
 *   value, and `JSON.stringify` renders them all as `{}`.
 * - `bigint`, `symbol`, `function` — no JSON form at all.
 *
 * These throw. They are programmer errors, not the kind of expected failure a `Result`
 * exists for: no caller can recover from having put a `Map` in a field spec.
 */

/** Matches `JSON.stringify`: `undefined` in an array becomes `null`. */
const serializeElement = (value: unknown): string =>
  value === undefined ? 'null' : serialize(value);

const isPlainObject = (value: object): boolean => {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const serialize = (value: unknown): string => {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';

    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalJson: ${String(value)} has no distinct JSON form`);
      }
      // -0 and 0 are the same value to `Object.is`-unaware readers and must not hash apart.
      return JSON.stringify(Object.is(value, -0) ? 0 : value);

    case 'string':
      return JSON.stringify(value);

    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map(serializeElement).join(',')}]`;
      }
      if (!isPlainObject(value)) {
        throw new TypeError(
          `canonicalJson: ${value.constructor?.name ?? 'object'} has no canonical JSON form; ` +
            'convert it to a plain object or a string first',
        );
      }

      const entries: string[] = [];
      // Sorting the keys is the whole point: property insertion order must not reach a hash.
      for (const key of Object.keys(value).sort()) {
        const property: unknown = (value as Record<string, unknown>)[key];
        // Matches `JSON.stringify`: an undefined property is absent, not null.
        if (property === undefined) continue;
        entries.push(`${JSON.stringify(key)}:${serialize(property)}`);
      }
      return `{${entries.join(',')}}`;
    }

    default:
      throw new TypeError(`canonicalJson: cannot serialise ${typeof value}`);
  }
};

/**
 * Returns the canonical JSON text of `value`.
 *
 * @throws TypeError when `value` contains something with no single JSON form.
 */
export const canonicalJson = (value: unknown): string => {
  if (value === undefined) {
    throw new TypeError('canonicalJson: undefined has no JSON form');
  }
  return serialize(value);
};
