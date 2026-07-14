/**
 * Bundles the CLI into one file, so `npx luminx` is one package.
 *
 * The monorepo splits LuminX into @luminx/shared, /core, /parsers, /codegen and /adapter-craft, and
 * that split is real: it is what `check:purity` enforces, and what keeps the core from knowing any
 * CMS. But it is an *internal* boundary. Nobody types `npm install @luminx/core` — they type
 * `npx luminx`. Publishing five libraries to serve one command would mean five versions to keep in
 * lockstep, and a scope to own, for an interface no user ever touches.
 *
 * So the workspace packages are compiled into the binary and never published. The architecture
 * stays split at the source; the artefact is whole.
 *
 * What stays external, and why:
 *
 *   typescript      The Astro importer parses a user's Zod schema with the compiler API. It is tens
 *                   of megabytes and reaches for its own files at runtime; bundling it is a fight
 *                   with no prize.
 *   zod             Ships its own export map and relies on it. A real dependency is the honest way.
 *   jsonc-parser    Small, but there is nothing to gain from inlining it either.
 *
 * Everything else — including every node: builtin — esbuild leaves alone under platform 'node'.
 */

import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// fileURLToPath, not new URL().pathname: this repo lives in a directory with a space in its name,
// and .pathname would hand us "Luminx%20Deploy" — a path that does not exist.
const here = dirname(fileURLToPath(import.meta.url));

const { version } = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'));

const result = await build({
  entryPoints: [join(here, 'src/bin/luminx.ts')],
  outfile: join(here, 'dist/bin/luminx.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // No shebang banner here: esbuild carries the entry file's own `#!` through to the output. Adding
  // one produces *two*, and Node strips only the first — the second is a syntax error, and the
  // binary does not run at all. Caught by installing the tarball into an empty directory, which is
  // the only test that sees what a stranger sees.
  external: ['typescript', 'zod', 'jsonc-parser'],
  // The version, baked in. See the note at its use in src/cli.ts.
  define: { __LUMINX_VERSION__: JSON.stringify(version) },
  // Small enough to read when something goes wrong in someone else's terminal.
  minify: false,
  sourcemap: true,
  logLevel: 'info',
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs).reduce((sum, out) => sum + out.bytes, 0);
console.log(`  bundled → ${(bytes / 1024).toFixed(0)} kB`);
