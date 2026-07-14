/**
 * `luminx import` — read a frontend's content model and write the config that describes it.
 *
 * The frontend half of the missing link (docs/architecture.md, the header). A project like an
 * Astro site already declares its content shape, in a Zod schema, so the frontend can type it.
 * This reads that shape and writes `luminx.config.json`, so the same model can stand a CMS up
 * behind the site: `luminx import` then `luminx new`.
 *
 * It reads, and writes one file it owns. It never touches the frontend's own source.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { compile, validateConfig } from '@luminx/core';
import type { AdapterRegistry } from '@luminx/core';
import { probeProject } from '@luminx/parsers';

import { ExitCode, exitCodeForAll } from '../exit.js';
import type { Io } from '../io.js';
import { paint, renderErrors } from '../render.js';
import { importAstroContent } from '../import/astro.js';
import type { RegistryFactory } from './pipeline.js';

export interface ImportOptions {
  readonly root: string;
  readonly configPath: string;
  readonly cms: string;
  readonly force: boolean;
  /** Where the frontend declares its content. Defaults to Astro's location. */
  readonly from: string | undefined;
  readonly registryFor: RegistryFactory;
  readonly registry?: AdapterRegistry;
}

const DEFAULT_ASTRO_SCHEMA = 'src/content/config.ts';

const exists = async (path: string): Promise<boolean> => {
  const { access } = await import('node:fs/promises');
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export const runImport = async (io: Io, options: ImportOptions): Promise<ExitCode> => {
  if (!options.force && (await exists(options.configPath))) {
    io.stderr(
      `${paint(io.color, 'yellow', '!')} ${options.configPath} already exists. Pass --force to overwrite it.\n`,
    );
    return ExitCode.ConfigError;
  }

  const schemaPath = join(options.root, options.from ?? DEFAULT_ASTRO_SCHEMA);

  let source: string;
  try {
    source = await readFile(schemaPath, 'utf8');
  } catch {
    io.stderr(
      `${paint(io.color, 'yellow', '!')} No content schema at ${schemaPath}\n` +
        `  Point at one with --from, e.g. --from src/content.config.ts\n`,
    );
    return ExitCode.ConfigError;
  }

  /**
   * The handles the target CMS keeps for itself, asked of the adapter rather than guessed.
   *
   * Craft reserves `author`, `type`, `section` and more on every entry, and an Astro blog declares
   * `author` as a matter of course. Importing it as written produced a config that stood a CMS up
   * and then died on the ninth write. The importer stays CMS-neutral: it renames what it is told to
   * rename, and this is where the telling happens.
   */
  const registry = options.registry ?? options.registryFor(await probeProject(options.root));
  const adapter = registry.resolve(options.cms);
  if (!adapter.ok) {
    io.stderr(renderErrors(io.color, [adapter.error]));
    return exitCodeForAll([adapter.error]);
  }

  const imported = importAstroContent(
    source,
    options.cms,
    adapter.value.capabilities.reservedFieldHandles ?? [],
  );
  if (!imported.ok) {
    io.stderr(renderErrors(io.color, imported.error));
    return exitCodeForAll(imported.error);
  }

  // Compile what we produced, so `import` never writes a config the next command chokes on. The
  // mapping is opinionated; this is where an opinion that does not hold up gets caught.
  const validated = validateConfig(imported.value.config);
  if (!validated.ok) {
    io.stderr(renderErrors(io.color, validated.error));
    return exitCodeForAll(validated.error);
  }

  const compiled = compile(validated.value);
  if (!compiled.ok) {
    io.stderr(renderErrors(io.color, compiled.error));
    return exitCodeForAll(compiled.error);
  }

  await writeFile(
    options.configPath,
    `${JSON.stringify(imported.value.config, null, 2)}\n`,
    'utf8',
  );

  io.stdout(
    `${paint(io.color, 'green', '✔')} Wrote ${options.configPath}\n` +
      `  ${compiled.value.model.resources.size} resources from ${schemaPath}\n`,
  );

  // Every decision that reshaped or dropped something. A migration you cannot see you cannot trust.
  if (imported.value.notes.length > 0) {
    io.stdout(`\n  ${paint(io.color, 'bold', 'What changed shape:')}\n`);
    for (const note of imported.value.notes)
      io.stdout(`    ${paint(io.color, 'dim', '·')} ${note}\n`);
  }

  io.stdout(
    `\n  Review it, then ${paint(io.color, 'bold', 'luminx new')} to build a CMS behind the site, ` +
      `or ${paint(io.color, 'bold', 'luminx generate --dry-run')} against one you have.\n`,
  );

  return ExitCode.Success;
};
