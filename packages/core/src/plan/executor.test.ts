import { ErrorCode, err, luminxError, ok } from '@luminx/shared';
import type { CurrentModel, Operation, Plan, Resource } from '@luminx/shared';
import { describe, expect, it, vi } from 'vitest';

import { createMemoryAdapter, currentModelOf } from '../adapter/memory.js';
import type { CmsAdapter } from '../adapter/contract.js';
import { execute } from './executor.js';

const field = (handle: string): Resource =>
  ({
    kind: 'field',
    logicalId: `field:${handle}`,
    handle,
    name: handle,
    spec: { type: 'text' },
    dependsOn: [],
    hash: `sha256:${handle}`,
  }) as Resource;

const planOf = (operations: readonly Operation[]): Plan => ({
  version: 1,
  cms: 'memory',
  sourceHash: 'sha256:source',
  baseHash: 'sha256:base',
  operations,
  orphaned: [],
});

const context = { root: '/project', facts: {} as never };
const empty: CurrentModel = { resources: new Map() };

describe('execute', () => {
  it('applies every operation and records the UIDs', async () => {
    const plan = planOf([{ kind: 'create', resource: field('a'), phase: 1 }]);
    const report = await execute({ plan, adapter: createMemoryAdapter(), context, current: empty });

    expect(report.failure).toBeUndefined();
    expect(report.results.map((result) => result.status)).toEqual(['created']);
    expect(report.lockfile.resources['field:a']).toEqual({
      uid: 'uid-field-a',
      hash: 'sha256:a',
    });
  });

  // §10: if the process dies between two operations there must still be somewhere to go back to.
  it('takes the snapshot before the first write', async () => {
    const order: string[] = [];
    const memory = createMemoryAdapter();
    const adapter: CmsAdapter = {
      ...memory,
      snapshot: (...args) => {
        order.push('snapshot');
        return memory.snapshot(...args);
      },
      apply: (...args) => {
        order.push('apply');
        return memory.apply(...args);
      },
    };

    await execute({
      plan: planOf([{ kind: 'create', resource: field('a'), phase: 1 }]),
      adapter,
      context,
      current: empty,
    });

    expect(order).toEqual(['snapshot', 'apply']);
  });

  // A write with no way back is the one thing §10 exists to prevent.
  it('refuses to write when the snapshot fails', async () => {
    const memory = createMemoryAdapter();
    const apply = vi.fn(memory.apply);
    const adapter: CmsAdapter = {
      ...memory,
      apply,
      snapshot: () => Promise.resolve(err(luminxError(ErrorCode.ApplySnapshotFailed, 'no room'))),
    };

    const report = await execute({
      plan: planOf([{ kind: 'create', resource: field('a'), phase: 1 }]),
      adapter,
      context,
      current: empty,
    });

    expect(report.failure?.code).toBe('LX4002');
    expect(apply).not.toHaveBeenCalled();
    expect(report.snapshot).toBeNull();
  });

  it('takes no snapshot when nothing would be written', async () => {
    const memory = createMemoryAdapter();
    const snapshot = vi.fn(memory.snapshot);

    const report = await execute({
      plan: planOf([{ kind: 'skip', resource: field('a'), reason: 'unchanged' }]),
      adapter: { ...memory, snapshot },
      context,
      current: currentModelOf([field('a')]),
    });

    expect(snapshot).not.toHaveBeenCalled();
    expect(report.snapshot).toBeNull();
    expect(report.lockfile.resources['field:a']?.uid).toBe('uid-field-a');
  });

  // A CMS need not be globally transactional (§9.5). The report says what ran.
  it('stops at the first failure and reports what already ran', async () => {
    const memory = createMemoryAdapter();
    let calls = 0;

    const adapter: CmsAdapter = {
      ...memory,
      apply: (operation, applyContext) => {
        calls += 1;
        return calls === 2
          ? Promise.resolve(err(luminxError(ErrorCode.ApplyOperationFailed, 'boom')))
          : memory.apply(operation, applyContext);
      },
    };

    const report = await execute({
      plan: planOf([
        { kind: 'create', resource: field('a'), phase: 1 },
        { kind: 'create', resource: field('b'), phase: 1 },
        { kind: 'create', resource: field('c'), phase: 1 },
      ]),
      adapter,
      context,
      current: empty,
    });

    expect(report.failure?.code).toBe('LX4001');
    expect(report.results).toHaveLength(1);
    expect(report.snapshot).not.toBeNull();
    expect(calls).toBe(2);
  });

  // The lockfile records the CMS as it now is, not as it was planned to be.
  it('writes a lockfile for the half that applied', async () => {
    const memory = createMemoryAdapter();
    const adapter: CmsAdapter = {
      ...memory,
      apply: (operation, applyContext) =>
        operation.resource.handle === 'b'
          ? Promise.resolve(err(luminxError(ErrorCode.ApplyOperationFailed, 'boom')))
          : memory.apply(operation, applyContext),
    };

    const report = await execute({
      plan: planOf([
        { kind: 'create', resource: field('a'), phase: 1 },
        { kind: 'create', resource: field('b'), phase: 1 },
      ]),
      adapter,
      context,
      current: empty,
    });

    expect(Object.keys(report.lockfile.resources)).toEqual(['field:a']);
  });

  it('keeps the UID of a resource this run never touched, so phase 2 can point at it', async () => {
    const existing = field('a');
    const plan = planOf([
      { kind: 'skip', resource: existing, reason: 'unchanged' },
      { kind: 'create', resource: field('b'), phase: 1 },
    ]);

    let seen: ReadonlyMap<string, string> | undefined;
    const memory = createMemoryAdapter();
    const adapter: CmsAdapter = {
      ...memory,
      apply: (operation, applyContext) => {
        seen = applyContext.resolved;
        return memory.apply(operation, applyContext);
      },
    };

    await execute({ plan, adapter, context, current: currentModelOf([existing]) });

    expect(seen?.get('field:a')).toBe('uid-field-a');
  });

  it('drops a deleted resource from the lockfile', async () => {
    const existing = field('a');
    const report = await execute({
      plan: planOf([{ kind: 'delete', resource: existing, uid: 'uid-field-a' }]),
      adapter: createMemoryAdapter({ initial: [{ resource: existing, uid: 'uid-field-a' }] }),
      context,
      current: currentModelOf([existing]),
    });

    expect(report.lockfile.resources).toEqual({});
  });

  // An adapter that reports success with no UID has told us nothing, and the lockfile would
  // silently lose the resource.
  it('treats a missing UID as an internal error', async () => {
    const memory = createMemoryAdapter();
    const adapter: CmsAdapter = {
      ...memory,
      apply: (operation) =>
        Promise.resolve(
          ok({ logicalId: operation.resource.logicalId, uid: '', status: 'created', warnings: [] }),
        ),
    };

    const report = await execute({
      plan: planOf([{ kind: 'create', resource: field('a'), phase: 1 }]),
      adapter,
      context,
      current: empty,
    });

    expect(report.failure?.code).toBe('LX5001');
  });
});
