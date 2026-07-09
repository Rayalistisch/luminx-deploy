/**
 * Every parser here answers with a fact or with `null`. Never a guess, never a default.
 *
 * A malformed `composer.json` is not "no plugins installed"; it is "I could not tell you". The
 * difference matters when the answer decides whether LuminX writes to a database.
 */

/** Parses JSON, or returns null. Unlike `JSON.parse` it never throws at a call site. */
export const parseJsonObject = (text: string): Readonly<Record<string, unknown>> | null => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

/** Reads a `Record<string, string>` property, dropping entries that are not strings. */
export const stringRecord = (value: unknown): Readonly<Record<string, string>> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[key] = entry;
  }
  return result;
};
