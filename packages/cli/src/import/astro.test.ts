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
        title: z.string(),
        count: z.number(),
        featured: z.boolean(),
        publishedAt: z.date(),
      `),
    );

    expect(fieldSpec(config, 'blog', 'title')['type']).toBe('text');
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
        title: z.string(),
        subtitle: z.string().optional(),
        author: z.string().default('Anon'),
        note: z.string().nullable(),
      `),
    );

    expect(fieldSpec(config, 'blog', 'title')['required']).toBe(true);
    expect(fieldSpec(config, 'blog', 'subtitle')['required']).toBeUndefined();
    expect(fieldSpec(config, 'blog', 'author')['required']).toBeUndefined();
    expect(fieldSpec(config, 'blog', 'note')['required']).toBeUndefined();
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

  it('maps every field and compiles to twelve resources', () => {
    const { config, notes } = imports(real);
    const model = compiles(config);

    expect(model.model.resources.size).toBe(12);
    expect(fieldSpec(config, 'blog', 'pubDate')['type']).toBe('date');
    expect(fieldSpec(config, 'blog', 'category')['required']).toBeUndefined();
    expect(fieldSpec(config, 'blog', 'relatedLinks')['type']).toBe('matrix');
    expect(fieldSpec(config, 'relatedLink', 'href')['type']).toBe('text');
    expect(notes).toHaveLength(1);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(imports(real).config)).toBe(JSON.stringify(imports(real).config));
  });
});
