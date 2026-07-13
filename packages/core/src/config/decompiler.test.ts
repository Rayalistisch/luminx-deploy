import { describe, expect, it } from 'vitest';

import { compile } from './compiler.js';
import type { CompiledModel } from './compiler.js';
import { decompile } from './decompiler.js';
import { validateConfig } from './loader.js';

const compiled = (raw: unknown): CompiledModel => {
  const parsed = validateConfig(raw);
  if (!parsed.ok) throw new Error(`schema rejected: ${JSON.stringify(parsed.error)}`);
  const result = compile(parsed.value);
  if (!result.ok) throw new Error(`compile failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

/**
 * The round-trip §14 rests M11 on: a config that compiles, decompiles, and compiles again to the
 * same model. When it holds, an existing project adopting LuminX via `init --from-existing`
 * reports zero changes on its first `generate`. When it does not, the gap is an introspection bug.
 */
const roundTrips = (raw: unknown): void => {
  const first = compiled(raw);
  const config = decompile(first.cms, first.model.resources.values());

  const revalidated = validateConfig(config);
  expect(revalidated.ok, `decompiled config must revalidate: ${JSON.stringify(revalidated)}`).toBe(
    true,
  );

  const second = compiled(config);

  // The whole model must survive the trip, hashes and all.
  expect([...second.model.resources.keys()]).toEqual([...first.model.resources.keys()]);
  expect(second.sourceHash).toBe(first.sourceHash);
};

describe('decompile round-trips', () => {
  it('a plain field with settings', () => {
    roundTrips({
      version: 1,
      cms: 'memory',
      fields: { heading: { type: 'text', name: 'Heading', max: 60 } },
      sections: [
        {
          handle: 'pages',
          type: 'channel',
          entryTypes: [{ handle: 'page', fields: [{ $ref: '#/fields/heading', required: true }] }],
        },
      ],
    });
  });

  it('a filesystem and the volume that depends on it', () => {
    roundTrips({
      version: 1,
      cms: 'memory',
      filesystems: [
        { handle: 'local', type: 'local', path: '@webroot/uploads', url: '@web/uploads' },
      ],
      volumes: [{ handle: 'images', name: 'Images', fs: 'local' }],
    });
  });

  it('a relation field, whose sources are handles in the config and logicalIds in the IR', () => {
    roundTrips({
      version: 1,
      cms: 'memory',
      fields: { hero: { type: 'assets', name: 'Hero', sources: ['images'], maxRelations: 1 } },
      volumes: [{ handle: 'images', fs: 'local' }],
      filesystems: [{ handle: 'local', type: 'local', path: '@webroot' }],
      sections: [
        {
          handle: 'pages',
          type: 'channel',
          entryTypes: [{ handle: 'page', fields: [{ $ref: '#/fields/hero' }] }],
        },
      ],
    });
  });

  it('a matrix, whose entry types are $refs in the config and logicalIds in the IR', () => {
    roundTrips({
      version: 1,
      cms: 'memory',
      entryTypes: { hero: { name: 'Hero', fields: [{ handle: 'label', type: 'text' }] } },
      fields: {
        content: {
          type: 'matrix',
          name: 'Content',
          maxEntries: 3,
          entryTypes: [{ $ref: '#/entryTypes/hero' }],
        },
      },
      sections: [
        {
          handle: 'pages',
          type: 'channel',
          entryTypes: [{ handle: 'page', fields: [{ $ref: '#/fields/content' }] }],
        },
      ],
    });
  });

  it('the mutual relation cycle from §8.3', () => {
    roundTrips({
      version: 1,
      cms: 'memory',
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
            { handle: 'post', fields: [{ handle: 'back', type: 'entries', sources: ['pages'] }] },
          ],
        },
      ],
    });
  });

  it('every resource kind at once', () => {
    roundTrips({
      version: 1,
      cms: 'memory',
      filesystems: [{ handle: 'local', type: 'local', path: '@webroot' }],
      volumes: [{ handle: 'images', fs: 'local' }],
      categories: [{ handle: 'topics', maxLevels: 1, uriFormat: 'topics/{slug}' }],
      globals: [{ handle: 'site', fields: [{ handle: 'phone', type: 'text' }] }],
      userGroups: [{ handle: 'editors', permissions: ['accessCp'] }],
      sections: [
        {
          handle: 'pages',
          type: 'structure',
          maxLevels: 3,
          uriFormat: '{slug}',
          template: '_page',
          entryTypes: [
            {
              handle: 'page',
              fields: [
                { handle: 'seo', type: 'text', max: 60 },
                { handle: 'flag', type: 'boolean', default: true },
                { handle: 'money', type: 'money', currency: 'EUR' },
              ],
            },
          ],
        },
      ],
    });
  });

  it('a raw field, handed through untouched', () => {
    roundTrips({
      version: 1,
      cms: 'memory',
      fields: {
        super: {
          type: 'raw',
          name: 'Super',
          cms: { memory: { class: 'verbb\\Super', settings: { a: 1 } } },
        },
      },
      sections: [
        {
          handle: 'pages',
          type: 'channel',
          entryTypes: [{ handle: 'page', fields: [{ $ref: '#/fields/super' }] }],
        },
      ],
    });
  });
});

describe('decompile output shape', () => {
  it('emits only the collections that have something', () => {
    const model = compiled({
      version: 1,
      cms: 'memory',
      userGroups: [{ handle: 'editors', permissions: [] }],
    });

    const config = decompile('memory', model.model.resources.values()) as unknown as Record<
      string,
      unknown
    >;

    expect(config['userGroups']).toBeDefined();
    expect(config['sections']).toBeUndefined();
    expect(config['fields']).toBeUndefined();
  });

  it('carries the cms and the schema pointer', () => {
    const model = compiled({
      version: 1,
      cms: 'elsewhere',
      userGroups: [{ handle: 'e', permissions: [] }],
    });
    const config = decompile('elsewhere', model.model.resources.values()) as unknown as Record<
      string,
      unknown
    >;

    expect(config['cms']).toBe('elsewhere');
    expect(config['version']).toBe(1);
    expect(config['$schema']).toContain('luminx.dev');
  });
});
