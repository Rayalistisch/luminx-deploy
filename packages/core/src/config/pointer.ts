/**
 * RFC 6901 JSON pointers. What turns "invalid config" into a location an editor can jump to.
 *
 * The escaping is not decoration: a handle may legally contain `/` or `~`, and an unescaped
 * pointer would then address a different node than the one that failed.
 */

const escapeToken = (token: string): string => token.replaceAll('~', '~0').replaceAll('/', '~1');

/** `['sections', 0, 'handle']` becomes `/sections/0/handle`. The root is the empty string. */
export const pointerOf = (path: readonly (string | number)[]): string =>
  path.map((token) => `/${escapeToken(String(token))}`).join('');
