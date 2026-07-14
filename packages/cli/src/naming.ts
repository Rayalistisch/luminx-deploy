/**
 * The one rule for a handle the CMS keeps for itself.
 *
 * It lives here, alone, because two commands must agree on it or content lands nowhere. `import`
 * renames `author` to `blogAuthor` when it writes the config; `content push` then reads a markdown
 * file that still says `author`, and has to arrive at the same answer. Two copies of this rule that
 * drift apart would drop a field's content on the floor and report success.
 */

/** `author` on `blog` → `blogAuthor`. Predictable, collision-free, and the config is yours to edit. */
export const renamed = (owner: string, handle: string): string =>
  `${owner}${handle.charAt(0).toUpperCase()}${handle.slice(1)}`;
