/**
 * The one place a hash is computed. Always over canonical JSON, never over a value straight
 * from `JSON.stringify` — key order would leak into the digest and a resource that changed
 * nothing would look changed (docs/architecture.md §13).
 */

import { createHash } from 'node:crypto';

import { canonicalJson } from '@luminx/shared';

/** `sha256:<hex>`. Prefixed so a lockfile written today survives a change of algorithm. */
export const hashOf = (value: unknown): string =>
  `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
