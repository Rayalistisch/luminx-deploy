/**
 * Topological ordering within a phase (§8.3).
 *
 * `dependsOn` runs filesystem → volume and field → entryType → section. It is acyclic by
 * construction, because the edges that would close a cycle are wiring, and wiring is phase 2.
 *
 * Ties are broken by logicalId, not by config order. Two runs over the same config must produce
 * the same plan byte for byte (§13), and "the order the user happened to type them in" is not a
 * property of the model.
 */

import type { LogicalId, Resource } from '@luminx/shared';

/** Kahn's algorithm with a sorted frontier, so the output is one specific ordering, always. */
export const topologicalOrder = (resources: readonly Resource[]): readonly Resource[] => {
  const byId = new Map(resources.map((resource) => [resource.logicalId, resource]));

  // Only edges between resources in *this* set count: a phase-2 operation may reference a
  // resource that needs no phase-2 operation of its own.
  const pending = new Map<LogicalId, Set<LogicalId>>(
    resources.map((resource) => [
      resource.logicalId,
      new Set(resource.dependsOn.filter((id) => byId.has(id))),
    ]),
  );

  const dependents = new Map<LogicalId, LogicalId[]>();
  for (const [id, dependencies] of pending) {
    for (const dependency of dependencies) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), id]);
    }
  }

  const ready = [...pending.entries()]
    .filter(([, dependencies]) => dependencies.size === 0)
    .map(([id]) => id)
    .sort();

  const ordered: Resource[] = [];

  while (ready.length > 0) {
    // Sorted every round: the frontier is a set, and a set has no order of its own.
    const id = ready.shift() as LogicalId;
    const resource = byId.get(id);
    if (resource !== undefined) ordered.push(resource);

    for (const dependent of dependents.get(id) ?? []) {
      const dependencies = pending.get(dependent);
      dependencies?.delete(id);
      if (dependencies?.size === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
    pending.delete(id);
  }

  // Unreachable while the compiler keeps `dependsOn` acyclic. If it ever is not, emitting a
  // partial order silently would be far worse than saying so.
  if (ordered.length !== resources.length) {
    const stuck = resources
      .filter((resource) => !ordered.includes(resource))
      .map((resource) => resource.logicalId)
      .sort();
    throw new Error(`orderer: dependsOn is cyclic among ${stuck.join(', ')}`);
  }

  return ordered;
};
