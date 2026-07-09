/**
 * Which frontend framework a `package.json` declares.
 *
 * Returns every framework it finds, not the most likely one. A monorepo root that depends on
 * both Next.js and Astro is a fact; picking one of them would be a guess, and §3.3 forbids
 * parsers from guessing. The caller decides what to do with two answers.
 */

import { parseJsonObject, stringRecord } from './json.js';

export const FRAMEWORKS = [
  { id: 'next', packageName: 'next' },
  { id: 'nuxt', packageName: 'nuxt' },
  { id: 'astro', packageName: 'astro' },
  { id: 'sveltekit', packageName: '@sveltejs/kit' },
  { id: 'remix', packageName: '@remix-run/react' },
] as const;

export type FrameworkId = (typeof FRAMEWORKS)[number]['id'];

export interface Framework {
  readonly id: FrameworkId;
  /** The declared range, verbatim: `^15.0.0`. Not a resolved version — package.json has none. */
  readonly constraint: string;
}

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

  return FRAMEWORKS.flatMap(({ id, packageName }) => {
    const constraint = declared[packageName];
    return constraint === undefined ? [] : [{ id, constraint }];
  });
};
