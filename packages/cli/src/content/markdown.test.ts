import { describe, expect, it } from 'vitest';

import type { EntryTypeShape } from './markdown.js';
import { readContent } from './markdown.js';

/**
 * The entry type as the *config* has it — which is not what the markdown says.
 *
 * `import` renamed `author` to `blogAuthor`, because Craft keeps `author` for itself, and invented
 * `body` because a Zod schema has no room for the article. A content push that ignored either would
 * write an entry with no author and no text, and report success.
 */
const blog: EntryTypeShape = {
  handle: 'blog',
  fields: new Map([
    ['description', { type: 'text' }],
    ['blogAuthor', { type: 'text' }],
    ['category', { type: 'text' }],
    ['pubDateX', { type: 'date' }], // deliberately not `pubDate`: that becomes the entry's postDate
    ['body', { type: 'text' }],
    [
      'relatedLinks',
      {
        type: 'matrix',
        block: {
          handle: 'relatedLink',
          fields: new Map([
            ['href', { type: 'text' }],
            ['label', { type: 'text' }],
          ]),
        },
      },
    ],
  ]),
};

const file = (text: string, path = 'src/content/blog/my-post.md') => ({ path, text });

const read = (text: string, path?: string) => {
  const result = readContent([file(text, path)], 'blog', blog, 'body');
  if (!result.ok) throw new Error(`read failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

const one = (text: string, path?: string) => {
  const { entries } = read(text, path);
  const entry = entries[0];
  if (entry === undefined) throw new Error('no entry');
  return entry;
};

describe('a markdown file becomes an entry', () => {
  it('takes the slug from the file name, and the title from the frontmatter', () => {
    const entry = one(
      `---\ntitle: Hello there\n---\nThe body.`,
      'src/content/blog/online-marketing.md',
    );

    expect(entry.slug).toBe('online-marketing');
    expect(entry.title).toBe('Hello there');
    expect(entry.section).toBe('blog');
    expect(entry.entryType).toBe('blog');
  });

  // The article. It is in no Zod schema, and it is the thing the site exists for.
  it('writes the markdown body into the field import made for it', () => {
    const entry = one(`---\ntitle: T\n---\n# Heading\n\nA paragraph.`);
    expect(entry.fields['body']).toBe('# Heading\n\nA paragraph.');
  });

  /**
   * The rename, honoured. The file says `author`; the config calls it `blogAuthor` because Craft
   * would not take `author`. Looking only for the literal key would drop the value in silence.
   */
  it('follows the rename the config made for a handle Craft keeps', () => {
    const entry = one(`---\ntitle: T\nauthor: Ray\n---\nBody.`);

    expect(entry.fields['blogAuthor']).toBe('Ray');
    expect(entry.fields['author']).toBeUndefined();
  });

  it('makes pubDate the entry’s own postDate, not a field', () => {
    const entry = one(`---\ntitle: T\npubDate: 2026-02-27T00:00:00.000Z\n---\nBody.`);

    expect(entry.postDate).toBe('2026-02-27T00:00:00.000Z');
    expect(entry.fields['pubDate']).toBeUndefined();
  });

  it('does not make a field of the title — an entry already has one', () => {
    const entry = one(`---\ntitle: T\n---\nBody.`);
    expect(entry.fields['title']).toBeUndefined();
  });
});

describe('nested content', () => {
  it('turns a list of objects into matrix blocks', () => {
    const entry = one(
      `---\ntitle: T\nrelatedLinks:\n  - href: /seo\n    label: SEO\n  - href: /sea\n    label: SEA\n---\nBody.`,
    );

    expect(entry.fields['relatedLinks']).toEqual([
      { entryType: 'relatedLink', fields: { href: '/seo', label: 'SEO' } },
      { entryType: 'relatedLink', fields: { href: '/sea', label: 'SEA' } },
    ]);
  });

  // The real file has a `description` on each link, which the block has no field for.
  it('drops a block key the entry type does not have, rather than inventing one', () => {
    const entry = one(
      `---\ntitle: T\nrelatedLinks:\n  - href: /seo\n    label: SEO\n    description: Nope\n---\nBody.`,
    );

    expect(entry.fields['relatedLinks']).toEqual([
      { entryType: 'relatedLink', fields: { href: '/seo', label: 'SEO' } },
    ]);
  });
});

describe('nothing is dropped in silence', () => {
  it('reports a frontmatter key that is not a field', () => {
    const { entries, notes } = read(`---\ntitle: T\nnonsense: 3\n---\nBody.`);

    expect(entries[0]?.fields['nonsense']).toBeUndefined();
    expect(notes.some((note) => note.includes('nonsense'))).toBe(true);
  });

  it('refuses a file with no frontmatter rather than guessing at one', () => {
    const result = readContent([file('Just a body, no frontmatter.')], 'blog', blog, 'body');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error[0]?.message).toContain('No frontmatter');
  });

  it('refuses unreadable YAML rather than writing half an entry', () => {
    const result = readContent([file('---\ntitle: [unclosed\n---\nBody.')], 'blog', blog, 'body');
    expect(result.ok).toBe(false);
  });
});

describe('determinism (§13)', () => {
  it('pushes in the same order however the directory is read', () => {
    const files = [
      file('---\ntitle: B\n---\nb', 'blog/b.md'),
      file('---\ntitle: A\n---\na', 'blog/a.md'),
      file('---\ntitle: C\n---\nc', 'blog/c.md'),
    ];

    const forward = readContent(files, 'blog', blog, 'body');
    const backward = readContent([...files].reverse(), 'blog', blog, 'body');

    if (!forward.ok || !backward.ok) throw new Error('unreachable');

    expect(forward.value.entries.map((entry) => entry.slug)).toEqual(['a', 'b', 'c']);
    expect(JSON.stringify(forward.value)).toBe(JSON.stringify(backward.value));
  });
});
