import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { canonicalJson, logicalIdOf } from '@luminx/shared';
import type { ContentModel, FieldSpec, Resource } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { emitTypes } from './types.js';

const run = promisify(execFile);

/**
 * A model built by hand, because codegen reads the IR and must not depend on the compiler to make
 * one. `@luminx/codegen` depends on `shared` and nothing else (§4), and these tests hold it to it.
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

/** The property line for a field, so a test can assert on one type without matching a whole file. */
const lineFor = (output: string, handle: string): string =>
  output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${handle}:`)) ?? `<no line for ${handle}>`;

/** One field on one entry type — the smallest model that produces a property. */
const withField = (handle: string, spec: FieldSpec, required = false): string => {
  const model = modelOf([
    resource({ kind: 'field', handle, spec }),
    resource({
      kind: 'entryType',
      handle: 'page',
      spec: { fields: [{ field: logicalIdOf('field', handle), required }] },
    }),
  ]);

  return emitTypes(model);
};

describe('field types', () => {
  it('maps the scalars', () => {
    expect(lineFor(withField('a', { type: 'text' }), 'a')).toBe('a: string | null;');
    expect(lineFor(withField('a', { type: 'richtext' }), 'a')).toBe('a: string | null;');
    expect(lineFor(withField('a', { type: 'number' }), 'a')).toBe('a: number | null;');
    expect(lineFor(withField('a', { type: 'boolean' }), 'a')).toBe('a: boolean | null;');
    expect(lineFor(withField('a', { type: 'color' }), 'a')).toBe('a: string | null;');
  });

  // A Date object would be a lie: it arrives from an API as a string.
  it('maps a date to an ISO string, not a Date', () => {
    expect(lineFor(withField('at', { type: 'date' }), 'at')).toBe('at: string | null;');
  });

  // The whole point of a dropdown is that it is not any string.
  it('maps a dropdown to a union of its option values', () => {
    const output = withField('size', {
      type: 'dropdown',
      options: [
        { value: 's', label: 'Small' },
        { value: 'l', label: 'Large' },
      ],
    });

    expect(lineFor(output, 'size')).toBe("size: 's' | 'l' | null;");
  });

  it('maps a multiselect to an array of that union', () => {
    const output = withField('tags', {
      type: 'multiselect',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    });

    expect(lineFor(output, 'tags')).toBe("tags: ('a' | 'b')[];");
  });

  it('maps the CMS-provided shapes', () => {
    expect(lineFor(withField('a', { type: 'link' }), 'a')).toBe('a: LuminxLink | null;');
    expect(lineFor(withField('a', { type: 'money', currency: 'EUR' }), 'a')).toBe(
      'a: LuminxMoney | null;',
    );
    expect(lineFor(withField('a', { type: 'table', columns: [] }), 'a')).toBe(
      'a: LuminxTableRow[];',
    );
  });

  // We never looked inside `raw`. Pretending to know its shape would be a lie in a type.
  it('leaves raw as unknown', () => {
    expect(lineFor(withField('a', { type: 'raw', cms: { craft: {} } }), 'a')).toBe('a: unknown;');
  });
});

describe('relations', () => {
  // The difference between `entry.hero.url` and `entry.hero[0].url`. Getting this wrong is the
  // difference between a type that helps and one that lies.
  it('is a single value when only one relation is allowed, and an array otherwise', () => {
    expect(
      lineFor(withField('hero', { type: 'assets', sources: [], maxRelations: 1 }), 'hero'),
    ).toBe('hero: LuminxAsset | null;');
    expect(lineFor(withField('gallery', { type: 'assets', sources: [] }), 'gallery')).toBe(
      'gallery: LuminxAsset[];',
    );
  });

  // An entries field names sections; an entry from a section is one of that section's entry types.
  it('resolves an entries field to the entry types its sections hold', () => {
    const model = modelOf([
      resource({ kind: 'field', handle: 'copy', spec: { type: 'text' } }),
      resource({
        kind: 'entryType',
        handle: 'post',
        spec: { fields: [{ field: 'field:copy', required: true }] },
      }),
      resource({
        kind: 'section',
        handle: 'blog',
        spec: { type: 'channel', entryTypes: ['entryType:post'] },
      }),
      resource({
        kind: 'field',
        handle: 'related',
        spec: { type: 'entries', sources: ['section:blog'] },
      }),
      resource({
        kind: 'entryType',
        handle: 'page',
        spec: { fields: [{ field: 'field:related', required: false }] },
      }),
    ]);

    expect(lineFor(emitTypes(model), 'related')).toBe('related: Post[];');
  });

  it('falls back to the base entry when a section holds nothing yet', () => {
    const model = modelOf([
      resource({
        kind: 'field',
        handle: 'rel',
        spec: { type: 'entries', sources: ['section:ghost'] },
      }),
      resource({
        kind: 'entryType',
        handle: 'page',
        spec: { fields: [{ field: 'field:rel', required: false }] },
      }),
    ]);

    expect(lineFor(emitTypes(model), 'rel')).toBe('rel: LuminxEntry[];');
  });
});

describe('matrix', () => {
  it('is an array of the block types it nests, narrowable on __typename', () => {
    const model = modelOf([
      resource({ kind: 'field', handle: 'copy', spec: { type: 'text' } }),
      resource({
        kind: 'entryType',
        handle: 'textBlock',
        spec: { fields: [{ field: 'field:copy', required: true }] },
      }),
      resource({
        kind: 'entryType',
        handle: 'quoteBlock',
        spec: { fields: [{ field: 'field:copy', required: true }] },
      }),
      resource({
        kind: 'field',
        handle: 'body',
        spec: { type: 'matrix', entryTypes: ['entryType:textBlock', 'entryType:quoteBlock'] },
      }),
      resource({
        kind: 'entryType',
        handle: 'page',
        spec: { fields: [{ field: 'field:body', required: false }] },
      }),
    ]);

    const output = emitTypes(model);

    expect(lineFor(output, 'body')).toBe('body: (QuoteBlock | TextBlock)[];');
    expect(output).toContain("__typename: 'textBlock';");
  });
});

describe('required is per use, not per field', () => {
  // The same field is required in one entry type and optional in another. The types must say so.
  it('makes a required field non-nullable and an optional one nullable', () => {
    expect(lineFor(withField('a', { type: 'text' }, true), 'a')).toBe('a: string;');
    expect(lineFor(withField('a', { type: 'text' }, false), 'a')).toBe('a: string | null;');
  });

  // An array is never null. It is empty.
  it('never adds null to an array', () => {
    expect(lineFor(withField('a', { type: 'assets', sources: [] }, false), 'a')).toBe(
      'a: LuminxAsset[];',
    );
  });
});

describe('the shape of the file', () => {
  const model = modelOf([
    resource({ kind: 'field', handle: 'heading', spec: { type: 'text' } }),
    resource({
      kind: 'entryType',
      handle: 'page',
      spec: { fields: [{ field: 'field:heading', required: true }] },
    }),
    resource({
      kind: 'section',
      handle: 'pages',
      spec: { type: 'structure', entryTypes: ['entryType:page'] },
    }),
    resource({
      kind: 'globalSet',
      handle: 'siteSettings',
      spec: { fields: [{ field: 'field:heading', required: false }] },
    }),
  ]);

  it('maps every section to the entries it holds', () => {
    expect(emitTypes(model)).toContain('export interface LuminxSections {\n  pages: Page;\n}');
  });

  it('maps every global set', () => {
    expect(emitTypes(model)).toContain('export interface LuminxGlobals {');
    expect(emitTypes(model)).toContain('siteSettings: SiteSettings;');
  });

  it('offers a union of every entry type', () => {
    expect(emitTypes(model)).toContain('export type LuminxAnyEntry = Page;');
  });

  // §13, again: the same config emits the same bytes.
  it('is deterministic', () => {
    expect(emitTypes(model)).toBe(emitTypes(model));
  });

  it('says it is generated, and how to regenerate it', () => {
    expect(emitTypes(model)).toContain('Do not edit');
    expect(emitTypes(model)).toContain('luminx types');
  });
});

/**
 * The test that matters. Everything above asserts on strings, and a string that looks like
 * TypeScript is not TypeScript. This writes the output to disk and runs the compiler over it under
 * the same strictness the rest of the repo uses. If it does not compile, it does not ship.
 */
describe('the output actually compiles', () => {
  it('typechecks under strict TypeScript', async () => {
    const model = modelOf([
      resource({ kind: 'field', handle: 'heading', spec: { type: 'text' } }),
      resource({
        kind: 'field',
        handle: 'hero',
        spec: { type: 'assets', sources: [], maxRelations: 1 },
      }),
      resource({ kind: 'field', handle: 'gallery', spec: { type: 'assets', sources: [] } }),
      resource({
        kind: 'field',
        handle: 'size',
        spec: {
          type: 'dropdown',
          options: [
            { value: 's', label: 'S' },
            { value: 'l', label: 'L' },
          ],
        },
      }),
      resource({ kind: 'field', handle: 'price', spec: { type: 'money', currency: 'EUR' } }),
      resource({ kind: 'field', handle: 'rows', spec: { type: 'table', columns: [] } }),
      resource({ kind: 'field', handle: 'weird', spec: { type: 'raw', cms: { craft: {} } } }),
      resource({ kind: 'field', handle: 'copy', spec: { type: 'richtext' } }),
      resource({
        kind: 'entryType',
        handle: 'textBlock',
        spec: { fields: [{ field: 'field:copy', required: true }] },
      }),
      resource({
        kind: 'field',
        handle: 'body',
        spec: { type: 'matrix', entryTypes: ['entryType:textBlock'] },
      }),
      resource({
        kind: 'entryType',
        handle: 'page',
        spec: {
          fields: [
            { field: 'field:heading', required: true },
            { field: 'field:hero', required: false },
            { field: 'field:gallery', required: false },
            { field: 'field:size', required: false },
            { field: 'field:price', required: false },
            { field: 'field:rows', required: false },
            { field: 'field:weird', required: false },
            { field: 'field:body', required: false },
          ],
        },
      }),
      resource({
        kind: 'section',
        handle: 'pages',
        spec: { type: 'structure', entryTypes: ['entryType:page'] },
      }),
    ]);

    const dir = await mkdtemp(join(tmpdir(), 'luminx-types-'));
    const file = join(dir, 'luminx.ts');

    // A consumer, so the types are not merely syntactically valid but actually usable.
    const consumer = `
import type { LuminxSections, Page, TextBlock } from './luminx.js';

export const headingOf = (page: Page): string => page.heading;
export const heroUrl = (page: Page): string | undefined => page.hero?.url;
export const sizeOf = (page: Page): 's' | 'l' | null => page.size;
export const firstBlock = (page: Page): TextBlock | undefined => page.body[0];
export const anyPage = (sections: LuminxSections): Page => sections.pages;
`;

    await writeFile(file, emitTypes(model), 'utf8');
    await writeFile(join(dir, 'consumer.ts'), consumer, 'utf8');
    await writeFile(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2023',
          noEmit: true,
        },
        include: ['*.ts'],
      }),
      'utf8',
    );

    /**
     * `fileURLToPath`, never `.pathname` — the latter leaves the path percent-encoded, so the space
     * in this repository's own directory name becomes %20 and the compiler is not found. That bug
     * was fixed in the check scripts in M0 and walked straight back in here.
     */
    const tsc = fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url));

    // Fails the test with the compiler's own message when the generated types do not hold up.
    await expect(run('node', [tsc, '-p', dir])).resolves.toBeTruthy();
  }, 60_000);
});
