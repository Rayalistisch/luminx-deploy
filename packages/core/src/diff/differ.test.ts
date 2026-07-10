import { isNoop, summarize } from '@luminx/shared';
import type { CurrentModel, LuminxError, Operation, Plan, Resource } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { currentModelOf } from '../adapter/memory.js';
import { compile } from '../config/compiler.js';
import type { CompiledModel } from '../config/compiler.js';
import { validateConfig } from '../config/loader.js';
import { diff } from './differ.js';

const compiled = (raw: unknown): CompiledModel => {
  const parsed = validateConfig(raw);
  if (!parsed.ok) throw new Error(`schema rejected fixture: ${JSON.stringify(parsed.error)}`);
  const result = compile(parsed.value);
  if (!result.ok) throw new Error(`compile failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

const planOf = (desired: CompiledModel, current: CurrentModel, prune = false): Plan => {
  const result = diff({ desired, current, lockfile: null, prune });
  if (!result.ok) throw new Error(`diff failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

const errorsOf = (desired: CompiledModel, current: CurrentModel): readonly LuminxError[] => {
  const result = diff({ desired, current, lockfile: null });
  if (result.ok) throw new Error('expected a failure');
  return result.error;
};

const empty: CurrentModel = { resources: new Map() };

const resourcesOf = (model: CompiledModel): readonly Resource[] => [
  ...model.model.resources.values(),
];

const describeOps = (plan: Plan): string[] =>
  plan.operations.map((operation: Operation) =>
    'phase' in operation
      ? `${operation.kind}:${operation.phase} ${operation.resource.logicalId}`
      : `${operation.kind} ${operation.resource.logicalId}`,
  );

const simple = compiled({
  version: 1,
  cms: 'memory',
  sections: [
    {
      handle: 'pages',
      type: 'channel',
      entryTypes: [{ handle: 'page', fields: [{ handle: 'title', type: 'text' }] }],
    },
  ],
});

describe('diff: creating from nothing', () => {
  it('creates every resource, dependencies first', () => {
    expect(describeOps(planOf(simple, empty))).toEqual([
      'create:1 field:title',
      'create:1 entryType:page',
      'create:1 section:pages',
      'create:2 entryType:page',
      'create:2 section:pages',
    ]);
  });

  // §8.3: structure first, wiring once every UID exists.
  it('gives a phase-2 operation only to resources that have something to wire', () => {
    const plan = planOf(simple, empty);
    const phase2 = plan.operations.filter((op) => 'phase' in op && op.phase === 2);
    expect(phase2.map((op) => op.resource.logicalId)).toEqual(['entryType:page', 'section:pages']);
  });

  it('does not wire an entry type that has no fields', () => {
    const model = compiled({
      version: 1,
      cms: 'memory',
      sections: [
        { handle: 'pages', type: 'channel', entryTypes: [{ handle: 'page', fields: [] }] },
      ],
    });

    expect(describeOps(planOf(model, empty))).toEqual([
      'create:1 entryType:page',
      'create:1 section:pages',
      'create:2 section:pages',
    ]);
  });
});

describe('diff: idempotency', () => {
  // The most important test in the project (§13). A second `generate` that reports one update
  // is a bug.
  it('reports nothing but skips when the CMS already matches the config', () => {
    const plan = planOf(simple, currentModelOf(resourcesOf(simple)));

    expect(summarize(plan)).toEqual({ create: 0, update: 0, skip: 3, delete: 0, total: 3 });
    expect(isNoop(plan)).toBe(true);
  });

  it('is stable: the same inputs give byte-for-byte the same plan', () => {
    const current = currentModelOf(resourcesOf(simple).slice(0, 1));
    expect(JSON.stringify(planOf(simple, current))).toBe(JSON.stringify(planOf(simple, current)));
  });
});

describe('diff: updating', () => {
  // `name` is cosmetic and the handle is unchanged, so this is an update, never a recreate.
  const relabelled = compiled({
    version: 1,
    cms: 'memory',
    sections: [
      {
        handle: 'pages',
        type: 'channel',
        entryTypes: [
          { handle: 'page', name: 'Landing Page', fields: [{ handle: 'title', type: 'text' }] },
        ],
      },
    ],
  });

  it('updates structure in phase 1', () => {
    const plan = planOf(relabelled, currentModelOf(resourcesOf(simple)));
    const update = plan.operations.find((op) => op.kind === 'update');

    expect(update).toMatchObject({ kind: 'update', phase: 1, uid: 'uid-entryType-page' });
    expect(update?.kind === 'update' && update.changes).toEqual([
      { path: '/name', before: 'Page', after: 'Landing Page' },
    ]);
  });

  it('updates wiring in phase 2', () => {
    const before = compiled({
      version: 1,
      cms: 'memory',
      sections: [
        { handle: 'pages', type: 'channel', entryTypes: [{ handle: 'page', fields: [] }] },
      ],
    });
    const after = compiled({
      version: 1,
      cms: 'memory',
      sections: [
        {
          handle: 'pages',
          type: 'channel',
          entryTypes: [{ handle: 'page', fields: [{ handle: 'title', type: 'text' }] }],
        },
      ],
    });

    const plan = planOf(after, currentModelOf(resourcesOf(before)));
    const wiring = plan.operations.find((op) => op.kind === 'update' && op.phase === 2);

    expect(wiring?.resource.logicalId).toBe('entryType:page');
    expect(wiring?.kind === 'update' && wiring.changes[0]?.path).toBe('/spec/fields');
  });
});

describe('diff: renames', () => {
  const before = compiled({
    version: 1,
    cms: 'memory',
    sections: [{ handle: 'pages', type: 'channel', entryTypes: [{ handle: 'page', fields: [] }] }],
  });

  const after = compiled({
    version: 1,
    cms: 'memory',
    sections: [
      {
        handle: 'sitePages',
        previousHandle: 'pages',
        type: 'channel',
        entryTypes: [{ handle: 'page', fields: [] }],
      },
    ],
  });

  // Without previousHandle this would be a delete and a create — and a delete is lost content.
  it('turns a handle rename into an update against the old UID', () => {
    const plan = planOf(after, currentModelOf(resourcesOf(before)));
    const update = plan.operations.find((op) => op.resource.logicalId === 'section:sitePages');

    expect(update).toMatchObject({ kind: 'update', uid: 'uid-section-pages' });
    expect(plan.orphaned).toEqual([]);
  });

  it('reports the change of handle among the changes', () => {
    const plan = planOf(after, currentModelOf(resourcesOf(before)));
    const update = plan.operations.find((op) => op.kind === 'update');

    expect(update?.kind === 'update' && update.changes).toContainEqual({
      path: '/handle',
      before: 'pages',
      after: 'sitePages',
    });
  });

  it('refuses to rename something the CMS does not have', () => {
    const errors = errorsOf(after, empty);
    expect(errors[0]?.code).toBe('LX1009');
    expect(errors[0]?.logicalId).toBe('section:sitePages');
  });

  it('ignores the hint once the rename has been applied', () => {
    const plan = planOf(after, currentModelOf(resourcesOf(after)));
    expect(isNoop(plan)).toBe(true);
  });
});

describe('diff: orphans', () => {
  const both = compiled({
    version: 1,
    cms: 'memory',
    sections: [
      { handle: 'pages', type: 'channel', entryTypes: [{ handle: 'page', fields: [] }] },
      { handle: 'blog', type: 'channel', entryTypes: [{ handle: 'post', fields: [] }] },
    ],
  });

  const onlyPages = compiled({
    version: 1,
    cms: 'memory',
    sections: [{ handle: 'pages', type: 'channel', entryTypes: [{ handle: 'page', fields: [] }] }],
  });

  // §8.2: leaving something out of the config must never delete it.
  it('reports what the CMS has and the config does not, and does not touch it', () => {
    const plan = planOf(onlyPages, currentModelOf(resourcesOf(both)));

    expect(plan.orphaned.map((entry) => entry.logicalId)).toEqual([
      'entryType:post',
      'section:blog',
    ]);
    expect(plan.operations.some((op) => op.kind === 'delete')).toBe(false);
  });

  it('deletes only under prune, and never before what points at it', () => {
    const plan = planOf(onlyPages, currentModelOf(resourcesOf(both)), true);
    const deletes = plan.operations.filter((op) => op.kind === 'delete');

    expect(deletes.map((op) => op.resource.logicalId)).toEqual(['section:blog', 'entryType:post']);
    expect(deletes[0]).toMatchObject({ uid: 'uid-section-blog' });
  });
});

describe('diff: hashes', () => {
  it('carries the source hash, and a base hash of what it planned against', () => {
    const plan = planOf(simple, empty);
    expect(plan.sourceHash).toBe(simple.sourceHash);
    expect(plan.baseHash).toMatch(/^sha256:/);
  });

  it('gives a different base hash once the CMS holds something', () => {
    const against = planOf(simple, currentModelOf(resourcesOf(simple)));
    expect(against.baseHash).not.toBe(planOf(simple, empty).baseHash);
  });
});
