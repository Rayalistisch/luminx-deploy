import { describe, expect, it } from 'vitest';

import type { LuminxError, Result } from '@luminx/shared';

import { compile } from './compiler.js';
import type { CompiledModel } from './compiler.js';
import { validateConfig } from './loader.js';

const compileRaw = (raw: unknown): Result<CompiledModel, readonly LuminxError[]> => {
  const parsed = validateConfig(raw);
  if (!parsed.ok) throw new Error(`schema rejected the fixture: ${JSON.stringify(parsed.error)}`);
  return compile(parsed.value);
};

const expectOk = (raw: unknown): CompiledModel => {
  const result = compileRaw(raw);
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.value;
};

const expectErrors = (raw: unknown): readonly LuminxError[] => {
  const result = compileRaw(raw);
  if (result.ok) throw new Error('expected failure, got a compiled model');
  return result.error;
};

const base = { version: 1, cms: 'fake' };

const withSection = (entryTypes: unknown) => ({
  ...base,
  sections: [{ handle: 'pages', type: 'structure', entryTypes }],
});

describe('compile: hoisting', () => {
  // §9.3: entry types are globally reusable, so they are top-level resources. You may write
  // them nested; they do not live there.
  it('hoists a nested entry type into a top-level resource', () => {
    const { model } = expectOk(
      withSection([{ handle: 'default', fields: [{ handle: 'heading', type: 'text' }] }]),
    );

    expect([...model.resources.keys()]).toEqual([
      'entryType:default',
      'field:heading',
      'section:pages',
    ]);
  });

  it('makes a section depend on its entry types, and an entry type on its fields', () => {
    const { model } = expectOk(
      withSection([{ handle: 'default', fields: [{ handle: 'heading', type: 'text' }] }]),
    );

    expect(model.resources.get('section:pages')?.dependsOn).toEqual(['entryType:default']);
    expect(model.resources.get('entryType:default')?.dependsOn).toEqual(['field:heading']);
    expect(model.resources.get('field:heading')?.dependsOn).toEqual([]);
  });

  it('deduplicates an entry type reached through $ref', () => {
    const { model } = expectOk({
      ...base,
      entryTypes: { hero: { fields: [{ handle: 'heading', type: 'text' }] } },
      sections: [
        { handle: 'pages', type: 'channel', entryTypes: [{ $ref: '#/entryTypes/hero' }] },
        { handle: 'blog', type: 'channel', entryTypes: [{ $ref: '#/entryTypes/hero' }] },
      ],
    });

    expect([...model.resources.keys()].filter((id) => id.startsWith('entryType:'))).toEqual([
      'entryType:hero',
    ]);
  });
});

describe('compile: $ref', () => {
  it('expands a reusable field and keeps its name', () => {
    const { model } = expectOk({
      ...base,
      fields: { seoTitle: { type: 'text', name: 'SEO Title', max: 60 } },
      sections: [
        {
          handle: 'pages',
          type: 'channel',
          entryTypes: [
            { handle: 'default', fields: [{ $ref: '#/fields/seoTitle', required: true }] },
          ],
        },
      ],
    });

    const field = model.resources.get('field:seoTitle');
    expect(field?.name).toBe('SEO Title');
    expect(field?.spec).toEqual({ type: 'text', max: 60 });
    expect(model.resources.get('entryType:default')?.spec).toEqual({
      fields: [{ field: 'field:seoTitle', required: true }],
    });
  });

  it('lets the same field be required in one layout and optional in another', () => {
    const { model } = expectOk({
      ...base,
      fields: { seoTitle: { type: 'text' } },
      sections: [
        {
          handle: 'pages',
          type: 'channel',
          entryTypes: [
            { handle: 'a', fields: [{ $ref: '#/fields/seoTitle', required: true }] },
            { handle: 'b', fields: [{ $ref: '#/fields/seoTitle' }] },
          ],
        },
      ],
    });

    expect(model.resources.get('entryType:a')?.spec).toEqual({
      fields: [{ field: 'field:seoTitle', required: true }],
    });
    expect(model.resources.get('entryType:b')?.spec).toEqual({
      fields: [{ field: 'field:seoTitle', required: false }],
    });
  });

  it('reports a $ref that names nothing', () => {
    const errors = expectErrors(
      withSection([{ handle: 'default', fields: [{ $ref: '#/fields/nope' }] }]),
    );

    expect(errors[0]?.code).toBe('LX1005');
    expect(errors[0]?.pointer).toBe('/sections/0/entryTypes/0/fields/0');
    expect(errors[0]?.hint).toContain('"nope"');
  });
});

describe('compile: one handle, one definition', () => {
  it('accepts the same inline definition written twice', () => {
    const { model } = expectOk(
      withSection([
        { handle: 'a', fields: [{ handle: 'heading', type: 'text' }] },
        { handle: 'b', fields: [{ handle: 'heading', type: 'text' }] },
      ]),
    );

    expect(model.resources.get('field:heading')?.spec).toEqual({ type: 'text' });
  });

  it('refuses two definitions of one handle that disagree', () => {
    const errors = expectErrors(
      withSection([
        { handle: 'a', fields: [{ handle: 'heading', type: 'text' }] },
        { handle: 'b', fields: [{ handle: 'heading', type: 'richtext' }] },
      ]),
    );

    expect(errors[0]?.code).toBe('LX1010');
    expect(errors[0]?.hint).toContain('$ref');
  });

  it('refuses a duplicate section handle', () => {
    const errors = expectErrors({
      ...base,
      sections: [
        { handle: 'pages', type: 'channel', entryTypes: [{ handle: 'a', fields: [] }] },
        { handle: 'pages', type: 'channel', entryTypes: [{ handle: 'b', fields: [] }] },
      ],
    });

    expect(errors[0]?.code).toBe('LX1004');
    expect(errors[0]?.pointer).toBe('/sections/1');
  });
});

describe('compile: references are not dependencies', () => {
  it('makes a matrix field depend on its entry types', () => {
    const { model } = expectOk(
      withSection([
        {
          handle: 'default',
          fields: [
            {
              handle: 'content',
              type: 'matrix',
              entryTypes: [{ handle: 'hero', fields: [{ handle: 'heading', type: 'text' }] }],
            },
          ],
        },
      ]),
    );

    const matrix = model.resources.get('field:content');
    expect(matrix?.spec).toEqual({ type: 'matrix', entryTypes: ['entryType:hero'] });
    // A matrix cannot be created with no entry types, so this is a dependency, not wiring.
    expect(matrix?.dependsOn).toEqual(['entryType:hero']);
    expect(model.resources.has('entryType:hero')).toBe(true);
  });

  // The example from §8.3: Pages points at Blog, Blog points back at Pages.
  it('compiles two sections that reference each other', () => {
    const { model } = expectOk({
      ...base,
      sections: [
        {
          handle: 'pages',
          type: 'channel',
          entryTypes: [
            { handle: 'page', fields: [{ handle: 'related', type: 'entries', sources: ['blog'] }] },
          ],
        },
        {
          handle: 'blog',
          type: 'channel',
          entryTypes: [
            {
              handle: 'post',
              fields: [{ handle: 'backlink', type: 'entries', sources: ['pages'] }],
            },
          ],
        },
      ],
    });

    expect(model.resources.get('field:related')?.spec).toEqual({
      type: 'entries',
      sources: ['section:blog'],
    });
    expect(model.resources.get('field:related')?.dependsOn).toEqual([]);
  });

  it('reports a relation source that does not exist', () => {
    const errors = expectErrors(
      withSection([
        { handle: 'default', fields: [{ handle: 'rel', type: 'entries', sources: ['ghost'] }] },
      ]),
    );

    expect(errors[0]?.code).toBe('LX1005');
    expect(errors[0]?.message).toContain('section "ghost"');
  });

  it('makes a volume depend on its filesystem, and reports a missing one', () => {
    const { model } = expectOk({
      ...base,
      filesystems: [{ handle: 'local', type: 'local', path: '@webroot/uploads' }],
      volumes: [{ handle: 'images', fs: 'local' }],
    });
    expect(model.resources.get('volume:images')?.dependsOn).toEqual(['filesystem:local']);

    const errors = expectErrors({ ...base, volumes: [{ handle: 'images', fs: 'ghost' }] });
    expect(errors[0]?.code).toBe('LX1005');
    expect(errors[0]?.pointer).toBe('/volumes/0/fs');
  });
});

describe('compile: self-containing entry types', () => {
  // Found by asking whether a cycle was reachable at all: it is, and it used to overflow the
  // stack. Expansion must terminate with a message naming the entry type that ate itself.
  it('reports an entry type whose matrix nests itself', () => {
    const errors = expectErrors({
      ...base,
      entryTypes: {
        hero: {
          fields: [
            { handle: 'content', type: 'matrix', entryTypes: [{ $ref: '#/entryTypes/hero' }] },
          ],
        },
      },
      sections: [{ handle: 'pages', type: 'channel', entryTypes: [{ $ref: '#/entryTypes/hero' }] }],
    });

    expect(errors[0]?.code).toBe('LX1008');
    expect(errors[0]?.message).toContain('"hero" contains itself');
  });

  it('reports two entry types that nest each other', () => {
    const errors = expectErrors({
      ...base,
      entryTypes: {
        a: { fields: [{ handle: 'fa', type: 'matrix', entryTypes: [{ $ref: '#/entryTypes/b' }] }] },
        b: { fields: [{ handle: 'fb', type: 'matrix', entryTypes: [{ $ref: '#/entryTypes/a' }] }] },
      },
      sections: [{ handle: 'pages', type: 'channel', entryTypes: [{ $ref: '#/entryTypes/a' }] }],
    });

    expect(errors[0]?.code).toBe('LX1008');
  });

  it('still allows the same entry type twice in one matrix, which is not a cycle', () => {
    const { model } = expectOk({
      ...base,
      entryTypes: { hero: { fields: [] } },
      sections: [
        {
          handle: 'pages',
          type: 'channel',
          entryTypes: [
            {
              handle: 'default',
              fields: [
                {
                  handle: 'content',
                  type: 'matrix',
                  entryTypes: [{ $ref: '#/entryTypes/hero' }, { $ref: '#/entryTypes/hero' }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(model.resources.get('field:content')?.spec).toEqual({
      type: 'matrix',
      entryTypes: ['entryType:hero', 'entryType:hero'],
    });
  });
});

describe('compile: renames', () => {
  it('maps the new logicalId to the old one', () => {
    const { renames } = expectOk({
      ...base,
      sections: [
        {
          handle: 'sitePages',
          previousHandle: 'pages',
          type: 'channel',
          entryTypes: [{ handle: 'a', fields: [] }],
        },
      ],
    });

    expect([...renames]).toEqual([['section:sitePages', 'section:pages']]);
  });

  it('is empty when nothing was renamed', () => {
    expect(expectOk(withSection([{ handle: 'a', fields: [] }])).renames.size).toBe(0);
  });

  it('refuses a previousHandle equal to the handle', () => {
    const errors = expectErrors({
      ...base,
      sections: [
        {
          handle: 'pages',
          previousHandle: 'pages',
          type: 'channel',
          entryTypes: [{ handle: 'a', fields: [] }],
        },
      ],
    });

    expect(errors[0]?.message).toContain('nothing was renamed');
    expect(errors[0]?.hint).toBe('Remove previousHandle.');
  });
});

describe('compile: determinism', () => {
  // Principle 1: same config, same plan. Config authoring order must not reach a hash.
  it('produces the same sourceHash regardless of the order things were written in', () => {
    const first = expectOk({
      ...base,
      sections: [
        { handle: 'blog', type: 'channel', entryTypes: [{ handle: 'post', fields: [] }] },
        { handle: 'pages', type: 'channel', entryTypes: [{ handle: 'page', fields: [] }] },
      ],
    });

    const second = expectOk({
      cms: 'fake',
      version: 1,
      sections: [
        { type: 'channel', handle: 'pages', entryTypes: [{ fields: [], handle: 'page' }] },
        { type: 'channel', handle: 'blog', entryTypes: [{ fields: [], handle: 'post' }] },
      ],
    });

    expect(second.sourceHash).toBe(first.sourceHash);
    expect([...second.model.resources.keys()]).toEqual([...first.model.resources.keys()]);
  });

  it('changes the sourceHash when anything changes', () => {
    const before = expectOk(withSection([{ handle: 'a', fields: [] }]));
    const after = expectOk(withSection([{ handle: 'a', fields: [{ handle: 'x', type: 'text' }] }]));
    expect(after.sourceHash).not.toBe(before.sourceHash);
  });
});

describe('compile: names', () => {
  it('derives a label from the handle when none is given', () => {
    const { model } = expectOk({
      ...base,
      sections: [
        { handle: 'sitePages', type: 'channel', entryTypes: [{ handle: 'a', fields: [] }] },
      ],
    });

    expect(model.resources.get('section:sitePages')?.name).toBe('Site Pages');
    expect(model.resources.get('entryType:a')?.name).toBe('A');
  });
});
