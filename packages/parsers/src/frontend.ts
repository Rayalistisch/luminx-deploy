/**
 * Which frontend framework a `package.json` declares.
 *
 * Returns every framework it finds, not the most likely one. A monorepo root that depends on
 * both Next.js and Astro is a fact; picking one of them would be a guess, and §3.3 forbids
 * parsers from guessing. The caller decides what to do with two answers.
 */

import type { Framework, FrameworkId } from '@luminx/shared';

import { parseJsonObject, stringRecord } from './json.js';

/** Which npm package betrays which framework. The ids themselves are part of ProjectFacts. */
export const FRAMEWORKS: readonly (readonly [FrameworkId, string])[] = [
  ['next', 'next'],
  ['nuxt', 'nuxt'],
  ['astro', 'astro'],
  ['sveltekit', '@sveltejs/kit'],
  ['remix', '@remix-run/react'],
];

export interface PackageJson {
  readonly name: string | null;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}

export const parsePackageJson = (text: string): PackageJson | null => {
  const root = parseJsonObject(text);
  if (root === null) return null;

  return {
    name: typeof root['name'] === 'string' ? root['name'] : null,
    dependencies: stringRecord(root['dependencies']),
    devDependencies: stringRecord(root['devDependencies']),
  };
};

export const detectFrameworks = (pkg: PackageJson): readonly Framework[] => {
  const declared = { ...pkg.devDependencies, ...pkg.dependencies };

  return FRAMEWORKS.flatMap(([id, packageName]) => {
    const constraint = declared[packageName];
    return constraint === undefined ? [] : [{ id, constraint }];
  });
};
