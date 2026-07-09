/**
 * `luminx init` — writes a minimal, valid `luminx.config.json`. It never touches the CMS
 * (docs/architecture.md §8.4).
 *
 * `--from-existing`, which introspects a populated CMS and writes the config that describes it,
 * needs an adapter and lands with M7.
 */

import { writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { validateConfig } from '@luminx/core';
import { ErrorCode, luminxError } from '@luminx/shared';

import { ExitCode } from '../exit.js';
import type { Io } from '../io.js';
import { paint, renderErrors } from '../render.js';

export interface InitOptions {
  readonly configPath: string;
  readonly force: boolean;
  /** Skips the prompts. Present as a flag so `init` is usable from a script. */
  readonly cms?: string | undefined;
  readonly siteName?: string | undefined;
}

const exists = async (path: string): Promise<boolean> => {
  const { access } = await import('node:fs/promises');
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export const runInit = async (io: Io, options: InitOptions): Promise<ExitCode> => {
  if (!options.force && (await exists(options.configPath))) {
    io.stderr(
      renderErrors(io.color, [
        luminxError(ErrorCode.ConfigSchemaViolation, `${options.configPath} already exists`, {
          hint: 'Pass --force to overwrite it.',
        }),
      ]),
    );
    return ExitCode.ConfigError;
  }

  const cms = options.cms ?? (await io.ask('Which CMS?', 'craft'));
  const siteName =
    options.siteName ?? (await io.ask('Site name?', basename(dirname(options.configPath))));

  const config = {
    $schema: 'https://luminx.dev/schema/v1.json',
    version: 1 as const,
    cms,
    siteName,
  };

  // Validating what we just wrote is cheap, and a broken `init` would poison every command
  // that follows it.
  const validated = validateConfig(config);
  if (!validated.ok) {
    io.stderr(renderErrors(io.color, validated.error));
    return ExitCode.InternalError;
  }

  await writeFile(options.configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  io.stdout(`${paint(io.color, 'green', '✔')} Wrote ${options.configPath}\n`);
  io.stdout(
    `  Next: describe your content model, then run ${paint(io.color, 'bold', 'luminx doctor')}.\n`,
  );

  return ExitCode.Success;
};
