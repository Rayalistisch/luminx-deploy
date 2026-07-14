/**
 * `luminx client` — the way back out.
 *
 * The model is managed, the content is pushed, and until now nothing read it. A CMS whose entries no
 * site displays is an archive with a login screen. This closes the loop: it opens a read-only door
 * in the CMS and generates the typed client that walks through it.
 *
 * Types and client come out of one file, from one config. Rename a field and the CMS, the types and
 * the query all move — or the build fails, which is the entire point of the project.
 *
 * The token is a secret. It goes to `.env`, never to the generated file, and the file is safe to
 * commit. Read-only, so even a leaked one cannot rewrite the content it was meant to show.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { compile, loadConfig } from '@luminx/core';
import type { AdapterRegistry } from '@luminx/core';
import { emitClient } from '@luminx/codegen';
import { probeProject } from '@luminx/parsers';
import type { LuminxError } from '@luminx/shared';
import { ErrorCode, luminxError } from '@luminx/shared';

import { ExitCode, exitCodeForAll } from '../exit.js';
import type { Io } from '../io.js';
import { paint, renderErrors } from '../render.js';
import type { RegistryFactory } from './pipeline.js';

export interface ClientOptions {
  readonly root: string;
  readonly configPath: string;
  /** Where the client goes. */
  readonly out: string | undefined;
  /** Where the frontend keeps its secrets. Defaults to the project's .env. */
  readonly envPath: string | undefined;
  readonly registryFor: RegistryFactory;
  readonly registry?: AdapterRegistry;
}

const DEFAULT_OUT = 'src/lib/luminx.ts';
const URL_KEY = 'LUMINX_CMS_URL';
const TOKEN_KEY = 'LUMINX_CMS_TOKEN';

const fail = (io: Io, errors: readonly LuminxError[]): ExitCode => {
  io.stderr(renderErrors(io.color, errors));
  return exitCodeForAll(errors);
};

/**
 * Writes a key into a `.env`, replacing the line that sets it rather than appending a second one.
 *
 * A file with `LUMINX_CMS_TOKEN` twice does not error — the last one silently wins, and which one
 * that is depends on the loader. Two runs of this command would leave a file whose meaning depends
 * on the tool reading it, which is not a thing anyone should have to reason about.
 */
const setEnv = async (path: string, values: Record<string, string>): Promise<void> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    text = '';
  }

  let next = text;

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const existing = new RegExp(`^${key}=.*$`, 'm');

    next = existing.test(next)
      ? next.replace(existing, line)
      : `${next}${next === '' || next.endsWith('\n') ? '' : '\n'}${line}\n`;
  }

  await writeFile(path, next, 'utf8');
};

export const runClient = async (io: Io, options: ClientOptions): Promise<ExitCode> => {
  const loaded = await loadConfig(options.configPath);
  if (!loaded.ok) return fail(io, loaded.error);

  const compiled = compile(loaded.value);
  if (!compiled.ok) return fail(io, compiled.error);

  const facts = await probeProject(options.root);
  const registry = options.registry ?? options.registryFor(facts);
  const adapter = registry.resolve(loaded.value.cms);
  if (!adapter.ok) return fail(io, [adapter.error]);

  if (adapter.value.openReadSide === undefined) {
    return fail(io, [
      luminxError(
        ErrorCode.EnvCmsNotDetected,
        `The "${adapter.value.id}" adapter has no read side`,
        { hint: 'Only some CMSes can be read this way. `luminx types` still works.' },
      ),
    ]);
  }

  io.stdout(`\n  Opening a read-only door in ${paint(io.color, 'bold', loaded.value.cms)}…\n`);

  const opened = await adapter.value.openReadSide({ root: options.root, facts });
  if (!opened.ok) return fail(io, [opened.error]);

  const { endpoint, token, sections } = opened.value;

  /**
   * The frontend and the CMS are usually different directories — `--cwd cms`, and the client
   * belongs with the site. So an absolute path means itself, rather than being nailed to the CMS's
   * root; joining it anyway produced `…/cms/private/tmp/…/src/lib/luminx.ts`, a path made of two
   * paths.
   */
  const under = (path: string) => (isAbsolute(path) ? path : join(options.root, path));

  // The client is generated from the config — the same config the CMS was built from.
  const source = emitClient(compiled.value.model);
  const out = options.out ?? DEFAULT_OUT;

  await writeFile(under(out), source, 'utf8');

  /**
   * The token goes to `.env`, and only there.
   *
   * Baking it into the generated file would put a CMS credential into a file that wants to be
   * committed — and the whole point of generating that file is that it *is* committed and reviewed.
   * Secrets and artefacts do not mix.
   */
  await setEnv(under(options.envPath ?? '.env'), { [URL_KEY]: endpoint, [TOKEN_KEY]: token });

  io.stdout(
    `  ${paint(io.color, 'green', '✔')} Wrote ${out}\n` +
      `  ${paint(io.color, 'green', '✔')} Wrote ${URL_KEY} and ${TOKEN_KEY} to ${options.envPath ?? '.env'}\n\n` +
      `  Readable: ${sections.join(', ')}\n\n`,
  );

  const first = sections[0] ?? 'section';

  io.stdout(
    `  ${paint(io.color, 'bold', 'Read it from the server:')}\n\n` +
      `    import { luminx } from './${out.replace(/^src\//, '').replace(/\.ts$/, '')}';\n\n` +
      `    const entries = await luminx().${first}();\n\n` +
      `  ${paint(io.color, 'dim', 'The token is read-only, and it is in .env — do not ship it to a browser.')}\n`,
  );

  return ExitCode.Success;
};
