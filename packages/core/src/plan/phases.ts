/**
 * The two-phase split (docs/architecture.md §8.3).
 *
 * Content models are cyclic: a field in Pages points at Blog, a field in Blog points back. No
 * ordering fixes that, so those references are left empty when the resource is created (phase 1)
 * and filled in once every UID exists (phase 2).
 *
 * **This is narrower than §8.3 describes.**
 *
 * §8.3 puts a section's entry types, and a matrix field's, in phase 2 — created empty, wired
 * later. A CMS is entitled to refuse that: a section with no entry types, or a matrix with no
 * nested types, may simply be invalid, with no moment at which it can exist empty. At least one
 * target CMS does refuse; see the adapter for which rules, and where.
 *
 * They do not need to be wiring. Both edges are acyclic — an entry type never points back at a
 * section, and a matrix nesting the entry type it belongs to is a config error the compiler
 * already refuses (LX1008). Topological ordering inside phase 1 places them before whatever
 * needs them, so they are dependencies.
 *
 * What remains genuinely cyclic is a relation field's `sources`: an `entries` field in Pages names
 * section Blog, whose entry type holds a field naming Pages. Nothing orders that. So the sources
 * of a relation field are the whole of phase 2, and a CMS can always create a relation field
 * pointing at nothing.
 *
 * Wiring is what ordering cannot solve. That is the whole definition.
 */

import type { Resource } from '@luminx/shared';

/** Pointers, relative to the resource, whose contents are filled in during phase 2. */
export const wiringPathsOf = (resource: Resource): readonly string[] => {
  if (resource.kind !== 'field') return [];

  switch (resource.spec.type) {
    case 'assets':
    case 'entries':
    case 'categories':
    case 'users':
      return ['/spec/sources'];
    default:
      return [];
  }
};

const valueAt = (resource: Resource, path: string): unknown =>
  path
    .split('/')
    .filter((token) => token !== '')
    .reduce<unknown>(
      (value, token) =>
        typeof value === 'object' && value !== null
          ? (value as Record<string, unknown>)[token]
          : undefined,
      resource,
    );

/**
 * True when there is something to wire. A relation field with no sources is complete after phase
 * 1, and giving it a phase-2 operation would make a second `generate` report work where there is
 * none.
 */
export const hasWiring = (resource: Resource): boolean =>
  wiringPathsOf(resource).some((path) => {
    const value = valueAt(resource, path);
    return Array.isArray(value) && value.length > 0;
  });

export const isWiringPath = (resource: Resource, path: string): boolean =>
  wiringPathsOf(resource).some((wiring) => path === wiring || path.startsWith(`${wiring}/`));
