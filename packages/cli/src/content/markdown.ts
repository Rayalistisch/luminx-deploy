/**
 * Markdown files, read into entries the CMS can hold.
 *
 * The frontend and the CMS disagree about where things live, and this is where that is reconciled.
 * A markdown file says `title` in its frontmatter; a CMS entry *has* a title, so it is not a field.
 * It says `author`, which Craft keeps for itself, so `luminx import` renamed it — and the content
 * has to follow that rename or it lands nowhere. And the article itself, the body, is in no schema
 * at all.
 *
 * So this does not map the file to the CMS. It maps the file to **the config**, which is the one
 * place that already knows what happened to every name. If a field is not in the entry type, its
 * value is dropped and said out loud — silently discarding someone's content is the worst outcome
 * available here.
 */

import { basename, extname } from 'node:path';

import { parse as parseYaml } from 'yaml';

import type { ContentEntry } from '@luminx/core';
import type { LuminxError } from '@luminx/shared';
import { ErrorCode, err, luminxError, ok } from '@luminx/shared';
import type { Result } from '@luminx/shared';

import { renamed } from '../naming.js';

/** `---\n…\n---\n` at the very top, and everything after it. Astro's format, and Jekyll's before it. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface MarkdownFile {
  /** Path, for the error message. The slug comes from the file name. */
  readonly path: string;
  readonly text: string;
}

/** The entry type a section holds, and the fields it accepts — read from the config, not the CMS. */
export interface EntryTypeShape {
  readonly handle: string;
  /** Field handle → what kind of field it is, so a matrix can be filled as a matrix. */
  readonly fields: ReadonlyMap<string, FieldShape>;
}

export interface FieldShape {
  readonly type: string;
  /** For a matrix: the entry type of its blocks, and that block's own fields. */
  readonly block?: EntryTypeShape;
}

export interface ContentResult {
  readonly entries: readonly ContentEntry[];
  /** Everything that did not fit, so nothing is dropped in silence. */
  readonly notes: readonly string[];
}

/** `2026-02-27-my-post.md` → `2026-02-27-my-post`. The slug a file already has. */
const slugOf = (path: string): string => basename(path, extname(path));

/**
 * The field a frontmatter key belongs to — under the name the *config* gave it.
 *
 * A markdown file says `author`. Craft keeps that handle for itself, so `import` wrote the field as
 * `blogAuthor`. If content push looked only for `author` it would find no field, drop the value,
 * and cheerfully report that it wrote the entry. Same rule, same answer, one definition of it.
 */
const fieldFor = (
  type: EntryTypeShape,
  key: string,
): { handle: string; shape: FieldShape } | null => {
  const direct = type.fields.get(key);
  if (direct !== undefined) return { handle: key, shape: direct };

  const handle = renamed(type.handle, key);
  const shape = type.fields.get(handle);

  return shape === undefined ? null : { handle, shape };
};

/**
 * A frontmatter value, coerced to what the field wants.
 *
 * YAML gives us dates as Date, numbers as number, and Craft wants an ISO string for a date field.
 * Everything else passes through: the CMS is a better judge of its own types than we are.
 */
const valueFor = (shape: FieldShape, value: unknown, path: string, handle: string): unknown => {
  if (shape.type === 'date') {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
  }

  if (shape.type === 'matrix' && Array.isArray(value)) {
    const block = shape.block;
    if (block === undefined) return [];

    return value.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return [];

      const fields: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(item as Record<string, unknown>)) {
        // A block is an entry type too, so its handles were renamed by the same rule.
        const field = fieldFor(block, key);
        if (field === null) continue;
        fields[field.handle] = valueFor(field.shape, inner, path, `${handle}.${key}`);
      }

      return [{ entryType: block.handle, fields }];
    });
  }

  return value;
};

/**
 * One file → one entry.
 *
 * `title` and the body are not fields; they are what an entry *is*. Everything else must be a field
 * the entry type actually declares, or it is dropped — loudly.
 */
const entryOf = (
  file: MarkdownFile,
  section: string,
  type: EntryTypeShape,
  bodyHandle: string | null,
  notes: string[],
): Result<ContentEntry, readonly LuminxError[]> => {
  const match = FRONTMATTER.exec(file.text);

  if (match === null) {
    return err([
      luminxError(ErrorCode.ConfigSchemaViolation, `No frontmatter in ${file.path}`, {
        hint: 'A content file starts with `---`, its frontmatter, and `---`.',
      }),
    ]);
  }

  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(match[1] ?? '');
  } catch (error: unknown) {
    return err([
      luminxError(
        ErrorCode.ConfigSchemaViolation,
        `Could not read the frontmatter of ${file.path}`,
        {
          hint: error instanceof Error ? error.message : 'Invalid YAML.',
        },
      ),
    ]);
  }

  if (typeof frontmatter !== 'object' || frontmatter === null) {
    return err([
      luminxError(ErrorCode.ConfigSchemaViolation, `The frontmatter of ${file.path} is not a map`),
    ]);
  }

  const front = frontmatter as Record<string, unknown>;
  const body = (match[2] ?? '').trim();
  const slug = slugOf(file.path);

  const fields: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(front)) {
    // The entry's own, not a field of it. `title` is the entry's title; the rest Craft owns.
    if (key === 'title' || key === 'slug' || key === 'id' || key === 'uri') continue;
    if (key === 'pubDate' || key === 'postDate' || key === 'date') continue; // → postDate, below

    const field = fieldFor(type, key);

    if (field === null) {
      notes.push(
        `${basename(file.path)}: "${key}" is not a field of "${type.handle}", so it was not written.`,
      );
      continue;
    }

    fields[field.handle] = valueFor(field.shape, value, file.path, key);
  }

  // The body, into the field `import` made for it.
  if (bodyHandle !== null && body !== '') {
    fields[bodyHandle] = body;
  } else if (body !== '' && bodyHandle === null) {
    notes.push(
      `${basename(file.path)}: it has a body, but "${type.handle}" has no field to hold it.`,
    );
  }

  const title = typeof front['title'] === 'string' ? front['title'] : slug;
  const posted = front['pubDate'] ?? front['date'] ?? front['postDate'];

  return ok({
    section,
    entryType: type.handle,
    slug,
    title,
    ...(posted instanceof Date
      ? { postDate: posted.toISOString() }
      : typeof posted === 'string'
        ? { postDate: posted }
        : {}),
    fields,
  });
};

export const readContent = (
  files: readonly MarkdownFile[],
  section: string,
  type: EntryTypeShape,
  bodyHandle: string | null,
): Result<ContentResult, readonly LuminxError[]> => {
  const entries: ContentEntry[] = [];
  const notes: string[] = [];
  const errors: LuminxError[] = [];

  // Sorted, so the same directory pushes in the same order every time (§13).
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const entry = entryOf(file, section, type, bodyHandle, notes);

    if (entry.ok) entries.push(entry.value);
    else errors.push(...entry.error);
  }

  return errors.length > 0 ? err(errors) : ok({ entries, notes });
};
