#!/usr/bin/env node
/**
 * Enforces the core principle from docs/architecture.md §1.3: the core knows no CMS.
 *
 * @luminx/shared and @luminx/core must not mention any concrete CMS — not in code,
 * not in types, not in comments. The moment they do, the abstraction has leaked and the
 * second adapter will require a refactor rather than a new package.
 *
 * @luminx/parsers is exempt: gathering facts about a project (which CMS, which version)
 * is precisely its job. It reads names; it does not encode semantics.
 *
 * Escape hatch: append `luminx-purity-ignore` to a line to allow it, with a reason.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const PURE_PACKAGES = ['shared', 'core'];

const FORBIDDEN = /\b(craft|wordpress|statamic|strapi|contentful|sanity|acf|yii|twig)\b/i;
const IGNORE_MARKER = 'luminx-purity-ignore';

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.endsWith('.ts')) yield path;
  }
}

const violations = [];
let filesScanned = 0;

for (const pkg of PURE_PACKAGES) {
  for await (const path of walk(join(ROOT, 'packages', pkg, 'src'))) {
    filesScanned++;
    const lines = (await readFile(path, 'utf8')).split('\n');

    lines.forEach((line, index) => {
      if (line.includes(IGNORE_MARKER)) return;
      const match = FORBIDDEN.exec(line);
      if (match) {
        violations.push({ file: relative(ROOT, path), line: index + 1, term: match[0], text: line.trim() });
      }
    });
  }
}

if (violations.length > 0) {
  console.error('Core purity violations — the core must not know about any specific CMS:\n');
  for (const { file, line, term, text } of violations) {
    console.error(`  ✖ ${file}:${line}  mentions "${term}"`);
    console.error(`      ${text}\n`);
  }
  console.error('Move this into an adapter, or express it through the IR. See docs/architecture.md §1.3.');
  process.exit(1);
}

console.log(`✔ purity: ${filesScanned} files in [${PURE_PACKAGES.join(', ')}] are CMS-agnostic`);
