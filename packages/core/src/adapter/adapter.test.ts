import type { ContentModel, Resource } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { checkCapabilities } from './capabilities.js';
import { createMemoryAdapter } from './memory.js';
import { createRegistry } from './registry.js';

const field = (type: string): Resource =>
  ({
    kind: 'field',
    logicalId: `field:x`,
    handle: 'x',
    name: 'X',
    spec: { type },
    dependsOn: [],
    hash: 'sha256:x',
  }) as Resource;

const modelOf = (resources: readonly Resource[]): ContentModel => ({
  resources: new Map(resources.map((resource) => [resource.logicalId, resource])),
});

describe('createRegistry', () => {
  it('resolves an adapter by its id', () => {
    const adapter = createMemoryAdapter();
    const registry = createRegistry([adapter]);

    expect(registry.resolve('memory')).toEqual({ ok: true, value: adapter });
    expect(registry.ids()).toEqual(['memory']);
  });

  it('names the adapters it does know when it cannot find one', () => {
    // Not a real CMS name: check:purity forbids one anywhere in core, tests included.
    const result = createRegistry([createMemoryAdapter()]).resolve('elsewhere');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('LX2002');
    expect(!result.ok && result.error.hint).toContain('memory');
  });

  it('says so when nothing is registered at all', () => {
    const result = createRegistry().resolve('elsewhere');
    expect(!result.ok && result.error.hint).toContain('No adapters are registered');
  });
});

describe('checkCapabilities', () => {
  // §7.1: a config using a field type this CMS lacks must fail before a plan exists, not
  // halfway through an apply with half a content model written.
  it('rejects a field type the adapter cannot express', () => {
    const capabilities = { fieldTypes: ['text'] as const, resourceKinds: ['field'] as const };
    const result = checkCapabilities(modelOf([field('money')]), capabilities, 'limited');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error[0]?.code).toBe('LX1007');
    expect(!result.ok && result.error[0]?.hint).toContain('raw');
  });

  it('rejects a resource kind the adapter cannot express', () => {
    const capabilities = { fieldTypes: ['text'] as const, resourceKinds: ['section'] as const };
    const result = checkCapabilities(modelOf([field('text')]), capabilities, 'limited');

    expect(!result.ok && result.error[0]?.message).toContain('does not support field resources');
  });

  it('accepts a model the memory adapter can express', () => {
    const { capabilities } = createMemoryAdapter();
    expect(checkCapabilities(modelOf([field('money')]), capabilities, 'memory').ok).toBe(true);
  });

  // §7.1: a field named something the CMS reserves fails at validation with a pointer, not
  // halfway through an apply. (The real reserved list lives in the adapter; core only enforces.)
  it('rejects a field whose handle the CMS reserves', () => {
    const reserved = {
      ...field('text'),
      handle: 'lockedName',
      logicalId: 'field:lockedName',
    } as Resource;
    const capabilities = {
      fieldTypes: ['text'] as const,
      resourceKinds: ['field'] as const,
      reservedFieldHandles: ['lockedName', 'other'],
    };

    const result = checkCapabilities(modelOf([reserved]), capabilities, 'elsewhere');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error[0]?.code).toBe('LX1011');
    expect(!result.ok && result.error[0]?.logicalId).toBe('field:lockedName');
  });

  it('reserves nothing when the adapter lists nothing', () => {
    const capabilities = { fieldTypes: ['text'] as const, resourceKinds: ['field'] as const };
    const named = {
      ...field('text'),
      handle: 'lockedName',
      logicalId: 'field:lockedName',
    } as Resource;

    expect(checkCapabilities(modelOf([named]), capabilities, 'elsewhere').ok).toBe(true);
  });
});

describe('createMemoryAdapter', () => {
  it('introspects what it was given', async () => {
    const resource = field('text');
    const adapter = createMemoryAdapter({ initial: [{ resource, uid: 'u1' }] });

    const result = await adapter.introspect({ root: '/', facts: {} as never });
    expect(result.ok && result.value.resources.get('field:x')?.uid).toBe('u1');
  });

  it('is a real implementation: applying a create makes introspect report it', async () => {
    const adapter = createMemoryAdapter();
    const resource = field('text');

    const applied = await adapter.apply(
      { kind: 'create', resource, phase: 1 },
      { root: '/', facts: {} as never, resolved: new Map() },
    );
    expect(applied.ok && applied.value.status).toBe('created');

    const after = await adapter.introspect({ root: '/', facts: {} as never });
    expect(after.ok && after.value.resources.has('field:x')).toBe(true);
  });

  it('forgets a resource that was deleted', async () => {
    const resource = field('text');
    const adapter = createMemoryAdapter({ initial: [{ resource, uid: 'u1' }] });

    await adapter.apply(
      { kind: 'delete', resource, uid: 'u1' },
      { root: '/', facts: {} as never, resolved: new Map() },
    );

    const after = await adapter.introspect({ root: '/', facts: {} as never });
    expect(after.ok && after.value.resources.size).toBe(0);
  });
});
