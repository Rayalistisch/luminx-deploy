import { describe, expect, it } from 'vitest';

import { logicalIdOf } from './ir.js';
import type { Resource } from './ir.js';
import { isNoop, summarize } from './plan.js';
import type { Operation, Plan } from './plan.js';

const section = (handle: string): Resource => ({
  kind: 'section',
  logicalId: logicalIdOf('section', handle),
  handle,
  name: handle,
  spec: { type: 'channel', entryTypes: [] },
  dependsOn: [],
  hash: `sha256:${handle}`,
});

const planOf = (operations: readonly Operation[]): Plan => ({
  version: 1,
  cms: 'fake',
  sourceHash: 'sha256:source',
  baseHash: 'sha256:base',
  operations,
  orphaned: [],
});

describe('logicalIdOf', () => {
  it('joins kind and handle, which is why a handle rename changes identity', () => {
    expect(logicalIdOf('section', 'pages')).toBe('section:pages');
    expect(logicalIdOf('section', 'sitePages')).not.toBe(logicalIdOf('section', 'pages'));
  });
});

describe('summarize', () => {
  it('counts each kind and the total', () => {
    const plan = planOf([
      { kind: 'create', resource: section('a'), phase: 1 },
      { kind: 'create', resource: section('b'), phase: 2 },
      { kind: 'update', resource: section('c'), uid: 'u1', changes: [], phase: 1 },
      { kind: 'skip', resource: section('d'), reason: 'unchanged' },
      { kind: 'delete', resource: section('e'), uid: 'u2' },
    ]);

    expect(summarize(plan)).toEqual({ create: 2, update: 1, skip: 1, delete: 1, total: 5 });
  });

  it('counts nothing for an empty plan', () => {
    expect(summarize(planOf([]))).toEqual({ create: 0, update: 0, skip: 0, delete: 0, total: 0 });
  });
});

describe('isNoop', () => {
  // The idempotency test in §13 rests on this: a second `generate` that reports anything
  // other than skips is a bug, and `sync --check` exits 1 on exactly this condition.
  it('is true when every operation is a skip', () => {
    expect(isNoop(planOf([{ kind: 'skip', resource: section('a'), reason: 'unchanged' }]))).toBe(
      true,
    );
  });

  it('is true for an empty plan', () => {
    expect(isNoop(planOf([]))).toBe(true);
  });

  it('is false as soon as one operation would write', () => {
    expect(
      isNoop(
        planOf([
          { kind: 'skip', resource: section('a'), reason: 'unchanged' },
          { kind: 'update', resource: section('b'), uid: 'u1', changes: [], phase: 2 },
        ]),
      ),
    ).toBe(false);
  });
});
