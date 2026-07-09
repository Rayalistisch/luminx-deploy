/**
 * Reads which keys a `.env` defines. It never returns a value, so no caller can leak one.
 *
 * §3.3 asks for "presence of keys, without logging values". A parser that returned the values
 * and trusted every future caller to be careful would be one refactor away from printing a
 * database password into a CI log. The values do not leave this file, because they never enter it.
 */

/** `export FOO=bar` and `FOO = bar` both define FOO. Comments and blank lines define nothing. */
const KEY = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

export const parseDotEnvKeys = (text: string): readonly string[] => {
  const keys = new Set<string>();

  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    const match = KEY.exec(line);
    if (match?.[1] !== undefined) keys.add(match[1]);
  }

  // Sorted: a set's iteration order is insertion order, and file order is not a fact worth carrying.
  return [...keys].sort();
};
