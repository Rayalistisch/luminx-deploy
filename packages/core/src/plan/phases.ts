/**
 * The two-phase split (docs/architecture.md §8.3).
 *
 * Content models are cyclic: a field in Pages points at Blog, a field in Blog points back. No
 * ordering fixes that, so every resource is created without its cross-references (phase 1),
 * and the references are filled in once every UID exists (phase 2).
 *
 * This module says which parts of a resource are *wiring*. Everything else is *structure*.
 * `dependsOn` is not wiring: a volume needs its filesystem's UID at creation, and ordering
 * inside phase 1 gives it one. Wiring is what ordering cannot solve.
 */

import type { Resource } from '@luminx/shared';

/** Pointers, relative to the resource, whose contents are filled in during phase 2. */
export const wiringPathsOf = (resource: Resource): readonly string[] => {
  switch (resource.kind) {
    case 'field':
      switch (resource.spec.type) {
        case 'matrix':
          return ['/spec/entryTypes'];
        case 'assets':
        case 'entries':
        case 'categories':
        case 'users':
          return ['/spec/sources'];
        default:
          return [];
      }
    // A field layout names fields by UID, so it cannot be built before they exist.
    case 'entryType':
    case 'globalSet':
      return ['/spec/fields'];
    case 'section':
      return ['/spec/entryTypes'];
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
 * True when there is something to wire. An entry type with no fields, or a matrix with no entry
 * types, is complete after phase 1 — and giving it a phase-2 operation would make a second
 * `generate` report work where there is none.
 */
export const hasWiring = (resource: Resource): boolean =>
  wiringPathsOf(resource).some((path) => {
    const value = valueAt(resource, path);
    return Array.isArray(value) && value.length > 0;
  });

export const isWiringPath = (resource: Resource, path: string): boolean =>
  wiringPathsOf(resource).some((wiring) => path === wiring || path.startsWith(`${wiring}/`));
