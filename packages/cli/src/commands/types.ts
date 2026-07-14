/**
 * `luminx types` — the content model, as TypeScript your frontend can hold on to.
 *
 * This is the link the project is named for. The CMS gets its sections and fields from
 * `luminx.config.json`; the frontend gets its types from the same file. Rename a field and your
 * Astro build breaks, which is what you wanted it to do.
 *
 * It reads the *config*, not a live CMS. So it needs no Docker, no PHP and no database: types can
 * be generated and typechecked in CI, on a machine that has never heard of Craft. A frontend that
 * cannot typecheck without a running CMS is a frontend that cannot typecheck.
 */

import { writeFile } from 'node:fs/promises';

import { emitTypes } from '@luminx/codegen';
import { compile, loadConfig } from '@luminx/core';

import { ExitCode, exitCodeForAll } from '../exit.js';
import type { Io } from '../io.js';
import { paint, renderErrors } from '../render.js';

export interface TypesOptions {
  readonly configPath: string;
  /** Where to write. Without it, the types go to stdout — which is a pipe, not an accident. */
  readonly out: string | undefined;
}

export const runTypes = async (io: Io, options: TypesOptions): Promise<ExitCode> => {
  const loaded = await loadConfig(options.configPath);
  if (!loaded.ok) {
    io.stderr(renderErrors(io.color, loaded.error));
    return exitCodeForAll(loaded.error);
  }

  const compiled = compile(loaded.value);
  if (!compiled.ok) {
    io.stderr(renderErrors(io.color, compiled.error));
    return exitCodeForAll(compiled.error);
  }

  const output = emitTypes(compiled.value.model);

  if (options.out === undefined) {
    io.stdout(output);
    return ExitCode.Success;
  }

  await writeFile(options.out, output, 'utf8');

  const entryTypes = [...compiled.value.model.resources.values()].filter(
    (resource) => resource.kind === 'entryType',
  ).length;

  io.stdout(
    `${paint(io.color, 'green', '✔')} Wrote ${options.out}\n` +
      `  ${entryTypes} entry type(s). Import them: ${paint(io.color, 'bold', `import type { LuminxSections } from './${options.out.split('/').pop() ?? 'luminx'}'`)}\n`,
  );

  return ExitCode.Success;
};
