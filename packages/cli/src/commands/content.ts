/**
 * `luminx content push` — the content itself, into the CMS.
 *
 * Every other command manages the *model*: sections, fields, entry types. That is project config —
 * a file, deterministic, reconciled, and reversible with `luminx undo`. This one is the only command
 * that writes to the database, and it deliberately does not behave like the others.
 *
 * **It never deletes.** Reconciliation is right for a schema and catastrophic for prose: a markdown
 * file removed from a repository must not take a published article with it — nor an editor's
 * morning of work on it. So this upserts on slug and stops. Removing an entry is a decision a human
 * makes in the CMS, and LuminX has no business making it for them.
 *
 * It reads the config to learn what a field is *called*, because `import` renamed the handles the
 * CMS keeps for itself. The config is the only place that knows.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { compile, loadConfig } from '@luminx/core';
import type { AdapterRegistry } from '@luminx/core';
import { probeProject } from '@luminx/parsers';
import type { ContentModel, LuminxError, Resource } from '@luminx/shared';
import { ErrorCode, luminxError } from '@luminx/shared';

import type { EntryTypeShape, FieldShape, MarkdownFile } from '../content/markdown.js';
import { readContent } from '../content/markdown.js';
import { ExitCode, exitCodeForAll } from '../exit.js';
import type { Io } from '../io.js';
import { paint, renderErrors } from '../render.js';
import type { RegistryFactory } from './pipeline.js';

export interface ContentOptions {
  readonly root: string;
  readonly configPath: string;
  readonly lockfilePath: string;
  /** The directory of markdown files. Defaults to Astro's, for the section being pushed. */
  readonly from: string | undefined;
  /** Which section to push into. Defaults to the only one, if there is only one. */
  readonly section: string | undefined;
  readonly dryRun: boolean;
  readonly registryFor: RegistryFactory;
  readonly registry?: AdapterRegistry;
}

const MARKDOWN = ['.md', '.mdx', '.markdown'];

/** The entry type a section holds, read off the compiled model — names as the CMS will know them. */
const shapeOf = (model: ContentModel, entryTypeId: string): EntryTypeShape | null => {
  const resource = model.resources.get(entryTypeId as Resource['logicalId']);
  if (resource?.kind !== 'entryType') return null;

  const fields = new Map<string, FieldShape>();

  for (const entry of resource.spec.fields) {
    const field = model.resources.get(entry.field);
    if (field?.kind !== 'field') continue;

    // A matrix carries its own entry type, and a block's fields were renamed by the same rule.
    const block =
      field.spec.type === 'matrix' && field.spec.entryTypes[0] !== undefined
        ? shapeOf(model, field.spec.entryTypes[0])
        : null;

    fields.set(field.handle, {
      type: field.spec.type,
      ...(block === null ? {} : { block }),
    });
  }

  return { handle: resource.handle, fields };
};

const markdownIn = async (dir: string): Promise<MarkdownFile[]> => {
  const names = await readdir(dir, { withFileTypes: true });

  const files = await Promise.all(
    names
      .filter((entry) => entry.isFile() && MARKDOWN.some((ext) => entry.name.endsWith(ext)))
      .map(async (entry) => ({
        path: join(dir, entry.name),
        text: await readFile(join(dir, entry.name), 'utf8'),
      })),
  );

  return files;
};

const fail = (io: Io, errors: readonly LuminxError[]): ExitCode => {
  io.stderr(renderErrors(io.color, errors));
  return exitCodeForAll(errors);
};

export const runContentPush = async (io: Io, options: ContentOptions): Promise<ExitCode> => {
  const loaded = await loadConfig(options.configPath);
  if (!loaded.ok) return fail(io, loaded.error);

  const compiled = compile(loaded.value);
  if (!compiled.ok) return fail(io, compiled.error);

  const model = compiled.value.model;

  const sections = [...model.resources.values()].filter((r) => r.kind === 'section');
  const section =
    options.section === undefined
      ? sections.length === 1
        ? sections[0]
        : undefined
      : sections.find((s) => s.handle === options.section);

  if (section === undefined || section.kind !== 'section') {
    return fail(io, [
      luminxError(
        ErrorCode.ConfigSchemaViolation,
        options.section === undefined
          ? 'More than one section: say which to push into'
          : `No section "${options.section}" in the config`,
        { hint: `--section <handle>. The config has: ${sections.map((s) => s.handle).join(', ')}` },
      ),
    ]);
  }

  const entryTypeId = section.spec.entryTypes[0];
  const shape = entryTypeId === undefined ? null : shapeOf(model, entryTypeId);

  if (shape === null) {
    return fail(io, [
      luminxError(ErrorCode.ConfigSchemaViolation, `Section "${section.handle}" has no entry type`),
    ]);
  }

  const dir = join(options.root, options.from ?? `src/content/${section.handle}`);

  let files: MarkdownFile[];
  try {
    files = await markdownIn(dir);
  } catch {
    return fail(io, [
      luminxError(ErrorCode.ConfigNotFound, `No content directory at ${dir}`, {
        hint: 'Point at one with --from, e.g. --from ../src/content/blog',
      }),
    ]);
  }

  if (files.length === 0) {
    io.stdout(`  Nothing to push: no markdown in ${dir}\n`);
    return ExitCode.Success;
  }

  // The body field is the one `import` invented, so it is whatever the config now calls it.
  const bodyHandle = shape.fields.has('body')
    ? 'body'
    : shape.fields.has(`${shape.handle}Body`)
      ? `${shape.handle}Body`
      : null;

  const read = readContent(files, section.handle, shape, bodyHandle);
  if (!read.ok) return fail(io, read.error);

  const { entries, notes } = read.value;

  io.stdout(
    `\n  ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} from ${dir}\n` +
      `  into ${paint(io.color, 'bold', section.handle)} (${shape.handle})\n\n`,
  );

  for (const entry of entries) {
    io.stdout(`  ${paint(io.color, 'dim', '·')} ${entry.slug}\n`);
  }

  // Everything that did not fit. A migration you cannot see is a migration you cannot trust.
  if (notes.length > 0) {
    io.stdout(`\n  ${paint(io.color, 'bold', 'Not written:')}\n`);
    for (const note of notes) io.stdout(`    ${paint(io.color, 'dim', '·')} ${note}\n`);
  }

  if (options.dryRun) {
    io.stdout(`\n  ${paint(io.color, 'yellow', '·')} --dry-run: nothing was written.\n`);
    return ExitCode.Success;
  }

  const facts = await probeProject(options.root);
  const registry = options.registry ?? options.registryFor(facts);
  const adapter = registry.resolve(loaded.value.cms);
  if (!adapter.ok) return fail(io, [adapter.error]);

  if (adapter.value.pushContent === undefined) {
    return fail(io, [
      luminxError(
        ErrorCode.EnvCmsNotDetected,
        `The "${adapter.value.id}" adapter cannot write content`,
        { hint: 'Only some CMSes can. The model is still managed by `luminx generate`.' },
      ),
    ]);
  }

  if (
    !io.assumeYes &&
    !(await io.confirm(`Write ${entries.length} entries to ${loaded.value.cms}?`))
  ) {
    io.stdout('  Cancelled. Nothing was written.\n');
    return ExitCode.Success;
  }

  const pushed = await adapter.value.pushContent(entries, { root: options.root, facts });
  if (!pushed.ok) return fail(io, [pushed.error]);

  io.stdout(
    `\n  ${paint(io.color, 'green', '✔')} ${pushed.value.created} created, ` +
      `${pushed.value.updated} updated.\n` +
      `  ${paint(io.color, 'dim', 'Nothing was deleted — content push never deletes.')}\n`,
  );

  return ExitCode.Success;
};
