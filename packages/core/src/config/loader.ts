/**
 * Reads and validates `luminx.config.json` (docs/architecture.md §3.2).
 *
 * Parsing is split from reading so the whole of validation is testable without a filesystem.
 * `loadConfig` is the only function here that touches disk.
 *
 * JSONC is accepted: comments explain why a field exists, and nothing in LuminX ever rewrites
 * the config after `init`, so no comment can be lost by a later command (§15.1).
 */

import { readFile } from 'node:fs/promises';

import { ErrorCode, err, luminxError, ok } from '@luminx/shared';
import type { LuminxError, Result } from '@luminx/shared';
import { type ParseError, parse, printParseErrorCode } from 'jsonc-parser';

import { pointerOf } from './pointer.js';
import { ConfigSchema } from './schema.js';
import type { LuminxConfig } from './types.js';

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

/** Turns a byte offset into a 1-based line and column, so the message points somewhere real. */
const positionOf = (text: string, offset: number): string => {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n');
  return `${line}:${column}`;
};

/**
 * Validates an already-parsed value. Every schema issue becomes one error with a JSON pointer;
 * we report all of them rather than only the first, because fixing configs one message per run
 * is how people come to hate a tool.
 */
export const validateConfig = (value: unknown): Result<LuminxConfig, readonly LuminxError[]> => {
  const result = ConfigSchema.safeParse(value);
  if (result.success) return ok(result.data);

  return err(
    result.error.issues.map((issue) =>
      luminxError(ErrorCode.ConfigSchemaViolation, issue.message, {
        pointer: pointerOf(issue.path.filter((token) => typeof token !== 'symbol')),
      }),
    ),
  );
};

export const parseConfig = (
  text: string,
  source: string,
): Result<LuminxConfig, readonly LuminxError[]> => {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    return err(
      errors.map((error) =>
        luminxError(
          ErrorCode.ConfigUnparsable,
          `${printParseErrorCode(error.error)} at ${positionOf(text, error.offset)}`,
          { hint: `${source} is not valid JSON or JSONC.` },
        ),
      ),
    );
  }

  // `extends` is documented in §3.2 but unimplemented. Say so, rather than let the strict
  // schema report it as an unrecognised key and leave the user guessing whether it is a typo.
  if (typeof value === 'object' && value !== null && 'extends' in value) {
    return err([
      luminxError(ErrorCode.ConfigSchemaViolation, '`extends` is not supported yet', {
        pointer: '/extends',
        hint: 'Inline the parent config for now. Config composition lands with a documented merge order.',
      }),
    ]);
  }

  return validateConfig(value);
};

export const loadConfig = async (
  path: string,
): Promise<Result<LuminxConfig, readonly LuminxError[]>> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return err([
        luminxError(ErrorCode.ConfigNotFound, `No config at ${path}`, {
          hint: 'Run `luminx init` to create one.',
        }),
      ]);
    }
    throw error;
  }

  return parseConfig(text, path);
};
