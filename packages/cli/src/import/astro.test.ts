import { capabilitiesFor } from '@luminx/adapter-craft';
import { compile, validateConfig } from '@luminx/core';
import { describe, expect, it } from 'vitest';

import { importAstroContent } from './astro.js';

/**
 * The importer reads a *user's* file, so the bar is not "does it parse the cases I thought of" but
 * "does what it produces compile". Every test here runs the output through LuminX's own validator
 * and compiler, the same gate `luminx import` puts it through, because a config that looks right
 * and does not compile is worse than none.
 */
const imports = (schema: string) => {
  const result = importAstroContent(schema, 'craft');
  if (!result.ok) throw new Error(`import failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

/** Builds a content/config.ts around one collection's schema body. */
const collection = (body: string, name = 'blog'): string => `
import { defineCollection, z } from 'astro:content';
const ${name} = defineCollection({ type: 'content', schema: z.object({${body}}) });
export const collections = { ${name} };
`;

/** The whole point: what comes out must compile. Returns the compiled model to assert on. */
const compiles = (config: unknown) => {
  const valid = validateConfig(config);
  expect(valid.ok, `should validate: ${JSON.stringify(valid)}`).toBe(true);
  if (!valid.ok) throw new Error('unreachable');

  const compiled = compile(valid.value);
  expect(compiled.ok, `should compile: ${JSON.stringify(compiled)}`).toBe(true);
  if (!compiled.ok) throw new Error('unreachable');

  return compiled.value;
};

/** Every field handle on an entry type, in order — so a test can assert on what was added. */
const handlesOf = (config: unknown, entryType: string): string[] =>
  (
    config as unknown as { entryTypes: Record<string, { fields: { handle: string }[] }> }
  ).entryTypes[entryType]?.fields.map((field) => field.handle) ?? [];

/** The field body for a handle inside an entry type, so a test can assert on one mapping. */
const fieldSpec = (config: unknown, entryType: string, handle: string): Record<string, unknown> => {
  const types = (config as { entryTypes: Record<string, { fields: Record<string, unknown>[] }> })
    .entryTypes;
  const found = types[entryType]?.fields.find((f) => f['handle'] === handle);
  return found ?? {};
};

describe('scalar fields', () => {
  it('maps the Zod scalars, and compiles', () => {
    const { config } = imports(
      collection(`
        heading: z.string(),
        count: z.number(),
        featured: z.boolean(),
        publishedAt: z.date(),
      `),
    );

    expect(fieldSpec(config, 'blog', 'heading')['type']).toBe('text');
    expect(fieldSpec(config, 'blog', 'count')['type']).toBe('number');
    expect(fieldSpec(config, 'blog', 'featured')['type']).toBe('boolean');
    expect(fieldSpec(config, 'blog', 'publishedAt')['type']).toBe('date');
    compiles(config);
  });

  it('reads z.coerce.date, the form Astro uses for frontmatter dates', () => {
    const { config } = imports(collection('pubDate: z.coerce.date(),'));
    expect(fieldSpec(config, 'blog', 'pubDate')['type']).toBe('date');
  });

  it('carries a string max through', () => {
    const { config } = imports(collection('summary: z.string().max(160),'));
    expect(fieldSpec(config, 'blog', 'summary')).toMatchObject({ type: 'text', max: 160 });
  });

  it('maps an enum to a dropdown of its values', () => {
    const { config } = imports(collection("status: z.enum(['draft', 'live']),"));
    expect(fieldSpec(config, 'blog', 'status')).toMatchObject({
      type: 'dropdown',
      options: [
        { value: 'draft', label: 'draft' },
        { value: 'live', label: 'live' },
      ],
    });
    compiles(config);
  });
});

describe('required is read from the Zod modifiers', () => {
  // A Zod field is required unless optional/default/nullable says otherwise.
  it('is required by default, and not when made optional or given a default', () => {
    const { config } = imports(
      collection(`
        heading: z.string(),
        subtitle: z.string().optional(),
        author: z.string().default('Anon'),
        note: z.string().nullable(),
      `),
    );

    expect(fieldSpec(config, 'blog', 'heading')['required']).toBe(true);
    expect(fieldSpec(config, 'blog', 'subtitle')['required']).toBeUndefined();
    expect(fieldSpec(config, 'blog', 'author')['required']).toBeUndefined();
    expect(fieldSpec(config, 'blog', 'note')['required']).toBeUndefined();
  });
});

/**
 * The bug that killed the flagship flow, and the test that keeps it dead.
 *
 * Every Astro blog begins `title: z.string()`. An entry already has a title, and Craft refuses a
 * field that shadows it — so `import` produced a config that scaffolded a CMS, wrote eight
 * resources, and then died on `handle: "title" is a reserved word`. Found by running the real
 * cyan-crater schema through a real Craft, which is the only place it could have been found.
 */
describe('the fields an entry already has', () => {
  it('does not emit a field for title, and says where it went', () => {
    const { config, notes } = imports(collection('title: z.string(), heading: z.string(),'));

    expect(fieldSpec(config, 'blog', 'title')).toEqual({});
    expect(fieldSpec(config, 'blog', 'heading')['type']).toBe('text');
    expect(notes.some((note) => note.includes('title'))).toBe(true);

    compiles(config);
  });

  it('leaves id, slug and uri to the entry too', () => {
    const { config } = imports(
      collection('id: z.string(), slug: z.string(), uri: z.string(), summary: z.string(),'),
    );

    // `body` is the field the importer adds for the markdown; the rest are the entry's own.
    expect(handlesOf(config, 'blog')).toEqual(['summary', 'body']);
  });

  // Craft's matrix blocks are entries as well, so `title` is no more allowed inside one.
  it('applies inside a matrix block, which is an entry as well', () => {
    const { config } = imports(
      collection('blocks: z.array(z.object({ title: z.string(), text: z.string() })),'),
    );

    expect(handlesOf(config, 'block')).toEqual(['text']);
    compiles(config);
  });
});

/**
 * The markdown itself.
 *
 * A Zod schema describes the frontmatter and stops there. The article — the reason the site exists —
 * is the text *below* it, and no schema mentions it. Import the schema alone and the CMS gets every
 * field about a post and nowhere to put the post.
 */
describe('the body the schema never mentions', () => {
  it('adds a field for the markdown, and says it did', () => {
    const { config, notes } = imports(collection('description: z.string(),'));

    expect(fieldSpec(config, 'blog', 'body')).toMatchObject({ type: 'text', multiline: true });
    expect(notes.some((note) => note.includes('markdown body'))).toBe(true);
    compiles(config);
  });

  /**
   * The collision this nearly shipped with.
   *
   * A schema may declare its own `body` in the frontmatter, and then two fields want one handle:
   * `field "body" is defined twice`. The config would not compile at all. The schema's field keeps
   * the name it was given; the markdown moves aside.
   */
  it('moves aside when the schema already has a body of its own', () => {
    const { config } = imports(collection('body: z.string(), description: z.string(),'));

    expect(handlesOf(config, 'blog')).toEqual(['body', 'description', 'blogBody']);
    compiles(config);
  });

  it('adds nothing to a data collection, which has no body', () => {
    const schema = `
      import { defineCollection, z } from 'astro:content';
      const authors = defineCollection({ type: 'data', schema: z.object({ name: z.string() }) });
      export const collections = { authors };
    `;

    expect(handlesOf(imports(schema).config, 'authors')).toEqual(['name']);
  });
});

/**
 * The handles the CMS keeps for itself — the second half of the same real failure.
 *
 * Craft reserves `author`, `section`, `type` and `postDate` on every entry (EntryType::validate),
 * on top of the element-wide list. `author: z.string()` is in half the Astro blogs there are, and
 * importing it as written produced a config that scaffolded a CMS and died on the ninth write.
 * The importer knows no CMS: it renames what the adapter tells it to rename.
 */
describe('handles the CMS keeps for itself', () => {
  const withReserved = (schema: string, reserved: string[]) => {
    const result = importAstroContent(schema, 'craft', reserved);
    if (!result.ok) throw new Error(`import failed: ${JSON.stringify(result.error)}`);
    return result.value;
  };

  it('renames a reserved handle after its entry type, and says so', () => {
    const { config, notes } = withReserved(collection('author: z.string(), body: z.string(),'), [
      'author',
    ]);

    expect(fieldSpec(config, 'blog', 'blogAuthor')['type']).toBe('text');
    expect(fieldSpec(config, 'blog', 'author')).toEqual({});
    expect(notes.some((note) => note.includes('author') && note.includes('blogAuthor'))).toBe(true);
    compiles(config);
  });

  it('renames inside a matrix block after the block, not the section', () => {
    const { config } = withReserved(
      collection('links: z.array(z.object({ type: z.string(), href: z.string() })),'),
      ['type'],
    );

    expect(fieldSpec(config, 'link', 'linkType')['type']).toBe('text');
    compiles(config);
  });

  it('leaves a handle alone when the CMS does not reserve it', () => {
    const { config } = withReserved(collection('author: z.string(),'), []);
    expect(fieldSpec(config, 'blog', 'author')['type']).toBe('text');
  });
});

describe('nested shapes', () => {
  // The interesting mapping: an array of objects is the one array shape a CMS models — a matrix.
  it('turns an array of objects into a matrix with a generated entry type', () => {
    const { config, notes } = imports(
      collection(`
        links: z.array(z.object({ href: z.string(), label: z.string() })),
      `),
    );

    expect(fieldSpec(config, 'blog', 'links')).toMatchObject({
      type: 'matrix',
      entryTypes: [{ $ref: '#/entryTypes/link' }],
    });

    const model = compiles(config);
    expect(model.model.resources.has('entryType:link')).toBe(true);
    expect(notes.some((note) => note.includes('matrix'))).toBe(true);
  });

  it('turns a bare object into a single-entry matrix', () => {
    const { config } = imports(collection('hero: z.object({ heading: z.string() }),'));

    expect(fieldSpec(config, 'blog', 'hero')).toMatchObject({
      type: 'matrix',
      minEntries: 1,
      maxEntries: 1,
    });
    compiles(config);
  });
});

describe('honesty about what does not map', () => {
  // A free list of scalars has no Craft field type. Keep it as raw, and say so — never drop it.
  it('keeps a list of scalars as raw, with a note', () => {
    const { config, notes } = imports(collection('tags: z.array(z.string()),'));

    expect(fieldSpec(config, 'blog', 'tags')['type']).toBe('raw');
    expect(notes.some((note) => note.includes('tags') && note.includes('raw'))).toBe(true);
    compiles(config);
  });

  it('keeps an unrecognised Zod type as raw rather than guessing', () => {
    const { config, notes } = imports(collection('when: z.string().datetime(),'));

    // datetime() is a string refinement we cannot express, but the base is still a string.
    expect(fieldSpec(config, 'blog', 'when')['type']).toBe('text');
    expect(notes).toBeDefined();
  });
});

describe('finding the collections', () => {
  it('resolves a shorthand export', () => {
    const { config } = imports(collection('title: z.string(),', 'articles'));
    expect((config as unknown as { sections: { handle: string }[] }).sections[0]?.handle).toBe(
      'articles',
    );
  });

  it('resolves an inline defineCollection in the export', () => {
    const schema = `
      import { defineCollection, z } from 'astro:content';
      export const collections = {
        pages: defineCollection({ schema: z.object({ title: z.string() }) }),
      };
    `;
    expect(
      (imports(schema).config as unknown as { sections: { handle: string }[] }).sections[0]?.handle,
    ).toBe('pages');
  });

  it('handles more than one collection', () => {
    const schema = `
      import { defineCollection, z } from 'astro:content';
      const blog = defineCollection({ schema: z.object({ title: z.string() }) });
      const docs = defineCollection({ schema: z.object({ heading: z.string() }) });
      export const collections = { blog, docs };
    `;
    const { config } = imports(schema);
    expect(
      (config as unknown as { sections: { handle: string }[] }).sections.map((s) => s.handle),
    ).toEqual(['blog', 'docs']);
    compiles(config);
  });

  it('reports when there are no collections rather than writing an empty config', () => {
    const result = importAstroContent('export const nothing = 1;', 'craft');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error[0]?.message).toContain('No Astro content collections');
  });
});

/**
 * cyan-crater's real schema, verbatim. The point of this whole feature is a real site, so a real
 * site's content config is the test that matters: it must map, and it must compile.
 */
describe('a real Astro schema (cyan-crater)', () => {
  /**
   * Craft's real reserved handles, from the real adapter — not a list invented for the test.
   *
   * This schema declares `author`, which Craft keeps for itself, and a test that quietly used an
   * empty reserved list would pass while the real command failed. It did, once: nine resources into
   * an apply, on a real database.
   */
  const craftReserves = capabilitiesFor({
    root: '/project',
    composer: { name: 'a/b', phpConstraint: '^8.3', require: {}, installed: {}, lock: 'parsed' },
    frameworks: [],
    detectedRunners: [],
    runner: 'local',
    envKeys: null,
  }).reservedFieldHandles;

  const imports = (schema: string) => {
    const result = importAstroContent(schema, 'craft', craftReserves ?? []);
    if (!result.ok) throw new Error(`import failed: ${JSON.stringify(result.error)}`);
    return result.value;
  };

  const real = `
    import { defineCollection, z } from 'astro:content';
    const blog = defineCollection({
      type: 'content',
      schema: z.object({
        title: z.string(),
        description: z.string(),
        pubDate: z.coerce.date(),
        author: z.string().default('Ray Huffenreuter'),
        category: z.string().optional(),
        image: z.string().optional(),
        relatedLinks: z.array(z.object({
          href: z.string(),
          label: z.string(),
          description: z.string().optional(),
        })).optional(),
      }),
    });
    export const collections = { blog };
  `;

  it('maps every field and compiles', () => {
    const { config, notes } = imports(real);
    const model = compiles(config);

    expect(model.model.resources.size).toBe(12);

    // `title` is the entry's own, so it is not a field of its own.
    expect(fieldSpec(config, 'blog', 'title')).toEqual({});
    expect(fieldSpec(config, 'blog', 'pubDate')['type']).toBe('date');
    expect(fieldSpec(config, 'blog', 'category')['required']).toBeUndefined();
    expect(fieldSpec(config, 'blog', 'relatedLinks')['type']).toBe('matrix');
    expect(fieldSpec(config, 'relatedLink', 'href')['type']).toBe('text');

    // The article, which the schema never mentions and the site is entirely made of.
    expect(fieldSpec(config, 'blog', 'body')).toMatchObject({ type: 'text', multiline: true });

    // Craft keeps `author` for itself, so the frontmatter's author moved aside.
    expect(fieldSpec(config, 'blog', 'blogAuthor')['type']).toBe('text');

    // Every reshaping reported: the title, the author, the matrix, the body.
    expect(notes).toHaveLength(4);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(imports(real).config)).toBe(JSON.stringify(imports(real).config));
  });
});
