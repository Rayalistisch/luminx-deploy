/**
 * The CLI's half of the wire protocol (§7.4).
 *
 * JSON travels through a file, not through stdout. Craft, Yii and any installed plugin write to
 * stdout unbidden — deprecation notices, debugger warnings — and we watched Craft 5.10 do exactly
 * that on PHP 8.5 while building the plugin. Parsing stdout would be fragile in a way that is
 * invisible until someone's machine has one extra warning.
 *
 * The exit code reports transport failure. A domain failure travels inside an envelope that
 * arrived intact. Confusing the two is how a tool ends up retrying a validation error.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { ErrorCode, PROTOCOL_VERSION, err, luminxError, ok } from '@luminx/shared';
import type { LuminxError, Result } from '@luminx/shared';

import type { Runner } from './runner.js';

/** Where request and response files live. Ignored by git; see the root .gitignore. */
export const EXCHANGE_DIR = '.luminx';

interface Envelope {
  readonly protocolVersion: number;
  readonly ok: boolean;
  readonly data?: unknown;
  readonly errors: readonly { code: string; message: string; hint?: string }[];
  readonly warnings: readonly string[];
  readonly diagnostics: Readonly<Record<string, string>>;
}

export interface CallResult {
  readonly data: unknown;
  readonly diagnostics: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
}

const isEnvelope = (value: unknown): value is Envelope =>
  typeof value === 'object' &&
  value !== null &&
  'protocolVersion' in value &&
  'ok' in value &&
  'errors' in value;

const KNOWN_CODES = new Set<string>(Object.values(ErrorCode));

/**
 * The plugin names its own failures with the same closed set of codes (§3.1). Passing the code
 * through is the whole reason both sides share it: a user greps `LX2005` and finds one meaning.
 * A code we do not recognise is a plugin newer than this CLI, and it is reported as such.
 */
const codeFrom = (code: string | undefined): ErrorCode =>
  code !== undefined && KNOWN_CODES.has(code)
    ? (code as ErrorCode)
    : ErrorCode.ProtocolMalformedResponse;

/**
 * A plugin that is not installed makes Craft exit with "Unknown command". Saying so beats
 * reporting a malformed response, which is what the missing response file would otherwise mean.
 */
const looksLikeMissingPlugin = (stderr: string, stdout: string): boolean =>
  /unknown command|unknown controller/i.test(`${stderr}\n${stdout}`);

export interface ProtocolClientOptions {
  readonly root: string;
  readonly runner: Runner;
  /** Called with every command before it runs. For `--verbose`. */
  readonly onCommand?: (command: string) => void;
  /** How long to wait for the response to appear. See `waitForFile`. */
  readonly responseTimeoutMs?: number;
}

const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;

/**
 * Waits for a file the container wrote to appear on the host.
 *
 * PHP writes the response inside a container, through a mounted volume. On macOS, DDEV syncs that
 * mount with Mutagen, and propagation back to the host is asynchronous — measured here at one to
 * six seconds against a real project. Reading immediately reports "the plugin wrote no response"
 * for a response the plugin had already written, which is a lie that then hides every real error.
 *
 * Only worth waiting for when PHP said it succeeded. A plugin Craft has never heard of exits
 * non-zero at once, and waiting thirty seconds to confirm that would be its own kind of wrong.
 */
const waitForFile = async (path: string, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      await stat(path);
      return true;
    } catch {
      if (Date.now() >= deadline) return false;
      await setTimeout(50);
    }
  }
};

export const createProtocolClient = (options: ProtocolClientOptions) => {
  const { root, runner } = options;

  const call = async (
    action: string,
    request: Readonly<Record<string, unknown>>,
  ): Promise<Result<CallResult, LuminxError>> => {
    const exchange = join(root, EXCHANGE_DIR);
    await mkdir(exchange, { recursive: true });

    const id = randomBytes(6).toString('hex');
    const requestPath = join(exchange, `req-${id}.json`);
    const responsePath = join(exchange, `res-${id}.json`);

    const payload = { ...request, protocolVersion: PROTOCOL_VERSION };
    await writeFile(requestPath, JSON.stringify(payload), 'utf8');

    /**
     * The paths on the wire are **relative to the project root**, never absolute.
     *
     * The CLI runs on the host and PHP usually runs in a container, where the project is mounted
     * at a different absolute path — `/var/www/html` under DDEV. An absolute host path names
     * nothing there, and every containerised run would fail on a file the CLI had just written.
     * Both sides run with the project root as their working directory, so a relative path means
     * the same file to both.
     *
     * `--requestPath`, not `--request`: Yii's Controller already owns `$request` and `$response`,
     * and its option parser maps a flag straight onto the property of that name.
     */
    const args = [
      action,
      `--requestPath=${posix.join(EXCHANGE_DIR, `req-${id}.json`)}`,
      `--responsePath=${posix.join(EXCHANGE_DIR, `res-${id}.json`)}`,
    ];
    options.onCommand?.(runner.describe(args));

    try {
      const execution = await runner.exec(args);

      const timeout =
        execution.code === 0 ? (options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS) : 0;
      const arrived = await waitForFile(responsePath, timeout);

      let text: string;
      try {
        if (!arrived) throw new Error('the response never appeared');
        text = await readFile(responsePath, 'utf8');
      } catch {
        if (looksLikeMissingPlugin(execution.stderr, execution.stdout)) {
          return err(
            luminxError(ErrorCode.EnvPluginMissing, 'Craft does not know the `luminx` command', {
              hint: 'Install the plugin: composer require luminx/craft-luminx',
            }),
          );
        }

        // Whatever PHP said is the most useful thing we have, and it is exactly what a file-based
        // protocol normally throws away.
        const said = execution.stderr.trim() || execution.stdout.trim();

        return err(
          luminxError(
            ErrorCode.ProtocolTransportFailure,
            `The plugin wrote no response (exit ${execution.code})`,
            said === '' ? {} : { hint: said },
          ),
        );
      }

      let envelope: unknown;
      try {
        envelope = JSON.parse(text);
      } catch {
        return err(
          luminxError(ErrorCode.ProtocolMalformedResponse, `${responsePath} is not valid JSON`),
        );
      }

      if (!isEnvelope(envelope)) {
        return err(
          luminxError(ErrorCode.ProtocolMalformedResponse, 'The response is not an envelope'),
        );
      }

      if (envelope.protocolVersion !== PROTOCOL_VERSION) {
        return err(
          luminxError(
            ErrorCode.ProtocolVersionMismatch,
            `The plugin speaks protocol v${envelope.protocolVersion}; this CLI speaks v${PROTOCOL_VERSION}.`,
            {
              hint:
                envelope.protocolVersion > PROTOCOL_VERSION
                  ? 'Update the CLI: npm install luminx@latest'
                  : 'Update the plugin: composer update luminx/craft-luminx',
            },
          ),
        );
      }

      if (!envelope.ok) {
        const first = envelope.errors[0];
        return err(
          luminxError(
            codeFrom(first?.code),
            first?.message ?? 'The plugin reported an error with no message',
            first?.hint === undefined ? {} : { hint: first.hint },
          ),
        );
      }

      return ok({
        data: envelope.data,
        diagnostics: envelope.diagnostics,
        warnings: envelope.warnings,
      });
    } finally {
      // The exchange files carry no secrets, but leaving them behind would grow without bound
      // and make `.luminx/` look like state that means something.
      await rm(requestPath, { force: true });
      await rm(responsePath, { force: true });
    }
  };

  return { call };
};

export type ProtocolClient = ReturnType<typeof createProtocolClient>;
