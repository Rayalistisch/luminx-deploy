#!/usr/bin/env node
/**
 * Enforces the dependency graph from docs/architecture.md §4.
 *
 * This reads package.json manifests rather than resolving imports, because the manifest
 * is what actually ships. A package cannot depend on something it does not declare.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const PACKAGES_DIR = new URL('../packages/', import.meta.url).pathname;

/** Which workspace packages each package is allowed to depend on. */
const ALLOWED = {
  '@luminx/shared': [],
  '@luminx/core': ['@luminx/shared'],
  '@luminx/parsers': ['@luminx/shared'],
  '@luminx/adapter-craft': ['@luminx/shared', '@luminx/core'],
  luminx: ['@luminx/shared', '@luminx/core', '@luminx/parsers', '@luminx/adapter-craft'],
};

const isWorkspacePackage = (name) => Object.hasOwn(ALLOWED, name);

const violations = [];

const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
const seen = new Set();

for (const entry of entries) {
  if (!entry.isDirectory()) continue;

  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(PACKAGES_DIR, entry.name, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') continue; // PHP packages have no package.json.
    throw error;
  }

  const self = manifest.name;
  seen.add(self);

  if (!isWorkspacePackage(self)) {
    violations.push(`${self} (packages/${entry.name}) is not listed in the allow-map in this script.`);
    continue;
  }

  const declared = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies });

  for (const dep of declared.filter(isWorkspacePackage)) {
    if (!ALLOWED[self].includes(dep)) {
      violations.push(`${self} must not depend on ${dep}. Allowed: [${ALLOWED[self].join(', ') || 'none'}]`);
    }
  }
}

for (const name of Object.keys(ALLOWED)) {
  if (!seen.has(name)) violations.push(`${name} is in the allow-map but no such package exists.`);
}

if (violations.length > 0) {
  console.error('Dependency graph violations:\n');
  for (const violation of violations) console.error(`  ✖ ${violation}`);
  console.error('\nSee docs/architecture.md §4.');
  process.exit(1);
}

console.log(`✔ boundaries: ${seen.size} packages, graph is acyclic and layered`);
