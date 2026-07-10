import type { LogicalId, Resource } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { topologicalOrder } from './orderer.js';

const node = (logicalId: LogicalId, dependsOn: LogicalId[] = []): Resource =>
  ({
    kind: 'field',
    logicalId,
    handle: logicalId,
    name: logicalId,
    spec: { type: 'text' },
    dependsOn,
    hash: 'sha256:x',
  }) as Resource;

const ids = (resources: readonly Resource[]) => resources.map((resource) => resource.logicalId);

describe('topologicalOrder', () => {
  it('puts a dependency before what depends on it', () => {
    expect(ids(topologicalOrder([node('b', ['a']), node('a')]))).toEqual(['a', 'b']);
  });

  it('orders a chain', () => {
    const chain = [node('c', ['b']), node('a'), node('b', ['a'])];
    expect(ids(topologicalOrder(chain))).toEqual(['a', 'b', 'c']);
  });

  // §13: the config's authoring order is not a property of the model, so it must not survive
  // into the plan. Independent resources are ordered by logicalId, always.
  it('breaks ties by logicalId, not by input order', () => {
    expect(ids(topologicalOrder([node('z'), node('a'), node('m')]))).toEqual(['a', 'm', 'z']);
    expect(ids(topologicalOrder([node('a'), node('m'), node('z')]))).toEqual(['a', 'm', 'z']);
  });

  it('sorts each frontier, not just the first', () => {
    const resources = [node('root'), node('z', ['root']), node('a', ['root'])];
    expect(ids(topologicalOrder(resources))).toEqual(['root', 'a', 'z']);
  });

  // A phase-2 operation may reference a resource with no phase-2 operation of its own.
  it('ignores dependencies on resources outside the set', () => {
    expect(ids(topologicalOrder([node('b', ['absent'])]))).toEqual(['b']);
  });

  it('is empty for no resources', () => {
    expect(topologicalOrder([])).toEqual([]);
  });

  // Unreachable while the compiler holds, and a silent partial order would be far worse.
  it('throws rather than emit a partial order when dependsOn is cyclic', () => {
    expect(() => topologicalOrder([node('a', ['b']), node('b', ['a'])])).toThrow(/cyclic/);
  });
});
