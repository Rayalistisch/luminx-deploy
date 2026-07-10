/**
 * `luminx.lock.json` — machine-written, committed to git (§5.3).
 *
 * It is never the source of truth. Lose it and it can be rebuilt from CMS introspection, at the
 * cost of rename detection. That is precisely why `previousHandle` is an instruction in the
 * config rather than a fact stored here.
 *
 * `generatedAt` is deliberately outside everything that gets hashed. A timestamp inside hashed
 * data would make every run differ from the last, which is the one thing §13 forbids.
 */

import { readFile, writeFile } from 'node:fs/promises';

import { ErrorCode, err, luminxError, ok } from '@luminx/shared';
import type { LogicalId, LuminxError, Result } from '@luminx/shared';
import { z } from 'zod';

export interface LockEntry {
  readonly uid: string;
  /** Canonical hash of the resource's spec at the time it was last applied. */
  readonly hash: string;
}

export interface Lockfile {
  readonly version: 1;
  readonly cms: string;
  readonly generatedAt: string;
  readonly resources: Readonly<Record<LogicalId, LockEntry>>;
}

const LockfileSchema: z.ZodType<Lockfile> = z.strictObject({
  version: z.literal(1),
  cms: z.string().min(1),
  generatedAt: z.string().min(1),
  resources: z.record(
    z.string(),
    z.strictObject({ uid: z.string().min(1), hash: z.string().min(1) }),
  ),
});

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

/**
 * Returns `null` when there is no lockfile — a first run, not a failure. A lockfile that exists
 * and does not parse *is* a failure: silently treating it as absent would drop every UID and
 * turn the next run into a pile of creates against resources that already exist.
 */
export const readLockfile = async (
  path: string,
): Promise<Result<Lockfile | null, readonly LuminxError[]>> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return ok(null);
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err([
      luminxError(ErrorCode.ConfigUnparsable, `${path} is not valid JSON`, {
        hint: 'Restore it from git, or delete it and re-run to rebuild from the CMS.',
      }),
    ]);
  }

  const parsed = LockfileSchema.safeParse(value);
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((issue) =>
        luminxError(ErrorCode.ConfigSchemaViolation, `${path}: ${issue.message}`),
      ),
    );
  }

  return ok(parsed.data);
};

export const emptyLockfile = (cms: string): Lockfile => ({
  version: 1,
  cms,
  generatedAt: new Date().toISOString(),
  resources: {},
});

export const writeLockfile = async (path: string, lockfile: Lockfile): Promise<void> => {
  // Keys sorted, so a lockfile committed by two developers does not conflict over ordering.
  const resources = Object.fromEntries(
    Object.entries(lockfile.resources).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  const body = { ...lockfile, resources };

  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
};

export const lookup = (lockfile: Lockfile | null, id: LogicalId): LockEntry | null =>
  lockfile?.resources[id] ?? null;
