#!/usr/bin/env node
/**
 * The entry point. Thin on purpose: parse, wire, run, translate the outcome into an exit code.
 *
 * Anything thrown that is not a UsageError is a bug in LuminX and exits 5 (§8.6). It must never
 * exit 0: a pipeline that reads a crash as success is worse than one that stops.
 */

import { randomUUID } from 'node:crypto';

import { UsageError, parseCli, runCommand } from '../cli.js';
import { ExitCode } from '../exit.js';
import { createIo } from '../io.js';

const main = async (): Promise<ExitCode> => {
  let parsed;
  try {
    parsed = parseCli(process.argv.slice(2));
  } catch (error: unknown) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\nTry \`luminx --help\`.\n`);
    return ExitCode.ConfigError;
  }

  // `color` is only ever forced *off*. Passing it through unconditionally would override the
  // TTY check and write escape codes into whatever file the user was piping into.
  const io = createIo({ assumeYes: parsed.yes, ...(parsed.color ? {} : { color: false }) });

  try {
    return await runCommand(parsed, io, process.cwd());
  } catch (error: unknown) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr(`${error.message}\nTry \`luminx --help\`.\n`);
    return ExitCode.ConfigError;
  }
};

try {
  process.exitCode = await main();
} catch (error: unknown) {
  const correlationId = randomUUID();
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);

  process.stderr.write(
    '\nLX5001  Internal error. This is a bug in LuminX.\n' +
      `        correlation-id: ${correlationId}\n\n${detail}\n`,
  );
  process.exitCode = ExitCode.InternalError;
}
