/**
 * `luminx undo` — restore the snapshot taken before the last apply (§10).
 *
 * Its limit, stated where the user reads it: this restores the *content model*, not the *content*.
 * A deleted section comes back empty. That is why `delete` is off by default (§8.2), and why the
 * confirmation says so out loud.
 */

import { compile, loadConfig } from '@luminx/core';
import type { AdapterRegistry } from '@luminx/core';
import { probeProject } from '@luminx/parsers';
import { ErrorCode, luminxError } from '@luminx/shared';
import type { LuminxError } from '@luminx/shared';

import { ExitCode, exitCodeFor, exitCodeForAll } from '../exit.js';
import type { Io } from '../io.js';
import { paint, renderErrors, renderJson } from '../render.js';
import type { RegistryFactory } from './generate.js';

export interface UndoOptions {
  readonly configPath: string;
  readonly root: string;
  readonly json: boolean;
  readonly list: boolean;
  readonly id: string | undefined;
  readonly registryFor: RegistryFactory;
  readonly registry?: AdapterRegistry;
}

const fail = (io: Io, errors: readonly LuminxError[], json: boolean): ExitCode => {
  if (json) io.stdout(renderJson({ ok: false, errors }));
  else io.stderr(renderErrors(io.color, errors));
  return exitCodeForAll(errors);
};

export const runUndo = async (io: Io, options: UndoOptions): Promise<ExitCode> => {
  const loaded = await loadConfig(options.configPath);
  if (!loaded.ok) return fail(io, loaded.error, options.json);

  const compiled = compile(loaded.value);
  if (!compiled.ok) return fail(io, compiled.error, options.json);

  const facts = await probeProject(options.root);
  const registry = options.registry ?? options.registryFor(facts);

  const adapter = registry.resolve(compiled.value.cms);
  if (!adapter.ok) return fail(io, [adapter.error], options.json);

  const context = { root: options.root, facts };

  if (options.list) {
    if (adapter.value.listSnapshots === undefined) {
      return fail(
        io,
        [
          luminxError(
            ErrorCode.ApplyRestoreFailed,
            `The "${adapter.value.id}" adapter cannot list snapshots`,
          ),
        ],
        options.json,
      );
    }

    const snapshots = await adapter.value.listSnapshots(context);
    if (!snapshots.ok) return fail(io, [snapshots.error], options.json);

    if (options.json) io.stdout(renderJson({ snapshots: snapshots.value }));
    else if (snapshots.value.length === 0) io.stdout('  No snapshots.\n');
    else {
      for (const snapshot of snapshots.value) {
        io.stdout(`  ${snapshot.id}  ${paint(io.color, 'dim', snapshot.createdAt)}\n`);
      }
    }
    return ExitCode.Success;
  }

  io.stdout(
    `  ${paint(io.color, 'yellow', '!')} undo restores the content model, not the content.\n` +
      `    Entries in a section this brings back will not come back with it.\n`,
  );

  if (!(await io.confirm('  Restore the last snapshot?'))) {
    io.stdout('  Cancelled. Nothing was changed.\n');
    return ExitCode.Success;
  }

  // An empty id means "the last one", and only the CMS side knows which that is.
  const restored = await adapter.value.restore(
    { id: options.id ?? '', createdAt: '', planHash: '' },
    context,
  );

  if (!restored.ok) {
    io.stderr(renderErrors(io.color, [restored.error]));
    return exitCodeFor(restored.error);
  }

  io.stdout(`\n  ${paint(io.color, 'green', '✔')} Restored.\n`);
  io.stdout(
    `  Run ${paint(io.color, 'bold', 'luminx generate --dry-run')} to see where you are.\n`,
  );

  return ExitCode.Success;
};
