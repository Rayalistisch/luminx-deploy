import { canonicalJson, logicalIdOf } from '@luminx/shared';
import type { ContentModel, Resource } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { emitClient } from './client.js';

/**
 * The client is generated code that lands in someone else's build, and its queries have to survive
 * contact with a real CMS. What is asserted here is what a real Craft was observed to require —
 * `post_Entry`, inline fragments on matrix blocks, `__typename` asked for explicitly — not what
 * seemed reasonable. Every one of these was learned by watching a query come back wrong.
 *
 * The model is built by hand: codegen reads the IR and depends on `shared` alone (§4). Reaching for
 * the compiler to make a fixture would quietly break the boundary these tests exist to protect.
 */
const resource = (
  partial: Partial<Resource> & Pick<Resource, 'kind' | 'handle' | 'spec'>,
): Resource =>
  ({
    logicalId: logicalIdOf(partial.kind, partial.handle),
    name: partial.handle,
    dependsOn: [],
    hash: `sha256:${canonicalJson(partial.spec)}`,
    ...partial,
  }) as Resource;

const modelOf = (resources: readonly Resource[]): ContentModel => ({
  resources: new Map(resources.map((entry) => [entry.logicalId, entry])),
});

/** A blog: a post with a scalar, an asset, and a matrix of links. */
const blog = (): ContentModel =>
  modelOf([
    resource({ kind: 'field', handle: 'summary', spec: { type: 'text' } }),
    resource({
      kind: 'field',
      handle: 'hero',
      spec: { type: 'assets', sources: [], maxRelations: 1 },
    }),
    resource({ kind: 'field', handle: 'href', spec: { type: 'text' } }),
    resource({
      kind: 'field',
      handle: 'links',
      spec: { type: 'matrix', entryTypes: [logicalIdOf('entryType', 'link')] },
    }),
    resource({
      kind: 'entryType',
      handle: 'link',
      spec: { fields: [{ field: logicalIdOf('field', 'href'), required: false }] },
    }),
    resource({
      kind: 'entryType',
      handle: 'post',
      spec: {
        fields: [
          { field: logicalIdOf('field', 'summary'), required: false },
          { field: logicalIdOf('field', 'hero'), required: false },
          { field: logicalIdOf('field', 'links'), required: false },
        ],
      },
    }),
    resource({
      kind: 'section',
      handle: 'blog',
      spec: {
        type: 'channel',
        uriFormat: 'blog/{slug}',
        template: 'blog/_entry',
        entryTypes: [logicalIdOf('entryType', 'post')],
      },
    }),
  ]);

describe('the query', () => {
  const source = emitClient(blog());

  it('asks for the section by handle', () => {
    expect(source).toContain('entries(section: "blog"');
  });

  /**
   * Craft answers with the entry type's *own* GraphQL type, and a field of that type is invisible
   * unless the query asks for it inside a fragment on it. Selecting `summary` at the top level
   * returns nothing at all — no error, just an absent field.
   */
  it('reaches an entry type’s fields through a fragment on its own type', () => {
    expect(source).toContain('... on post_Entry {');
    expect(source).toContain('summary');
  });

  // A matrix block is an entry type too, so it needs a fragment of its own, nested.
  it('reaches a matrix block through a fragment on the block’s type', () => {
    expect(source).toContain('links { ... on link_Entry {');
    expect(source).toContain('href');
  });

  /**
   * `__typename` is what the generated types narrow on. Not asking for it makes the field absent at
   * runtime, every `isType()` false, and every narrowing silently empty — with nothing thrown.
   */
  it('asks for __typename, which the types promise', () => {
    expect(source).toContain('__typename');
  });

  // An asset is an object: it answers nothing unless its own fields are named.
  it('selects the fields of a relation, not the relation', () => {
    expect(source).toContain('hero { id url filename title width height }');
  });
});

describe('the runtime', () => {
  const source = emitClient(blog());

  /**
   * Craft says `post_Entry`; the types say `post`. The types are built from the config and know no
   * CMS — that is why they are portable — so the *client* translates on the way in, and the runtime
   * value matches the type it was given.
   */
  it('maps the CMS’s type name back to the config’s handle', () => {
    expect(source).toContain(`"post_Entry": 'post'`);
    expect(source).toContain(`"link_Entry": 'link'`);
    expect(source).toContain('const normalize');
  });

  it('emits the types alongside the client, so they cannot drift apart', () => {
    expect(source).toContain('export interface Post extends LuminxEntry');
    expect(source).toContain('export const luminx');
  });

  it('gives a method per section, and one to fetch by slug', () => {
    expect(source).toContain('blog: (options');
    expect(source).toContain('blogBySlug: (slug: string)');
  });

  /**
   * A GraphQL error arrives with HTTP 200 and a `data` of nulls. Handing that back as if it were an
   * answer is how a page renders empty and nobody can say why.
   */
  it('throws on a GraphQL error rather than returning half an answer', () => {
    expect(source).toContain('The CMS rejected the query');
  });

  // The file lands in someone else's build: no parameter properties, no enums, nothing that emits.
  it('is erasable TypeScript, so type-stripping toolchains can run it', () => {
    expect(source).not.toMatch(/constructor\([^)]*readonly /);
    expect(source).not.toMatch(/\benum\b/);
  });
});

describe('determinism (§13)', () => {
  it('emits the same bytes for the same config', () => {
    expect(emitClient(blog())).toBe(emitClient(blog()));
  });
});

describe('a model with no sections', () => {
  it('emits no query rather than an empty selection, which is a syntax error', () => {
    const source = emitClient(modelOf([]));

    expect(source).not.toContain('entries(section:');
    expect(source).toContain('export const luminx');
  });
});
