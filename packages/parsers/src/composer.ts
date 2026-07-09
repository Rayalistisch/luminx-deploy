/**
 * `composer.json` states what the project asks for. `composer.lock` states what it actually has.
 *
 * Only the lock file answers "which version is installed". A constraint like `^5.0` is a wish,
 * and a doctor check that reads a wish as a fact will happily report a version nobody is running.
 */

import { parseJsonObject, stringRecord } from './json.js';

export interface ComposerJson {
  readonly name: string | null;
  /** The `php` constraint, if the project states one. */
  readonly php: string | null;
  readonly require: Readonly<Record<string, string>>;
  readonly requireDev: Readonly<Record<string, string>>;
}

export interface ComposerLock {
  /** Package name → exact installed version, both runtime and dev. */
  readonly installed: Readonly<Record<string, string>>;
}

export const parseComposerJson = (text: string): ComposerJson | null => {
  const root = parseJsonObject(text);
  if (root === null) return null;

  const require = stringRecord(root['require']);
  const php = require['php'];

  return {
    name: typeof root['name'] === 'string' ? root['name'] : null,
    php: php ?? null,
    require,
    requireDev: stringRecord(root['require-dev']),
  };
};

const collectPackages = (value: unknown, into: Record<string, string>): void => {
  if (!Array.isArray(value)) return;

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, version } = entry as { name?: unknown; version?: unknown };
    if (typeof name === 'string' && typeof version === 'string') into[name] = version;
  }
};

export const parseComposerLock = (text: string): ComposerLock | null => {
  const root = parseJsonObject(text);
  if (root === null) return null;

  const installed: Record<string, string> = {};
  collectPackages(root['packages'], installed);
  collectPackages(root['packages-dev'], installed);

  return { installed };
};

/** `v5.6.0` and `5.6.0` are the same version. Composer writes both, depending on the tag. */
export const normalizeVersion = (version: string): string => version.replace(/^v/, '');
