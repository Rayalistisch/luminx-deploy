/**
 * Astro content collections → `luminx.config.json` (the frontend half of the missing link).
 *
 * You describe your content once, in a Zod schema, so Astro can type it. This reads that schema
 * and produces the LuminX config, so the *same* model can stand a CMS up behind the site. Point
 * LuminX at a frontend, get a config that describes it — then `luminx new` builds the Craft.
 *
 * It reads the file with the TypeScript parser, not a regex: `content/config.ts` is real
 * TypeScript, with comments, trailing commas and nested generics, and only a real parser survives
 * contact with a file a human wrote.
 *
 * **The mapping is opinionated, and it says so.** A Zod schema is richer than any CMS content
 * model, so some constructs have no faithful home — a free `z.array(z.string())` is not a Craft
 * field. Rather than guess or silently drop, those become `raw` and are reported. Every decision
 * that lost or reshaped something comes back in `notes`, because a migration you cannot see is a
 * migration you cannot trust.
 */

import ts from 'typescript';

import { ErrorCode, err, luminxError, ok } from '@luminx/shared';
import type { LuminxError, Result } from '@luminx/shared';
import type { FieldBody, LuminxConfig } from '@luminx/core';

export interface ImportResult {
  readonly config: LuminxConfig;
  /** Every decision that reshaped or dropped something, so the migration is legible. */
  readonly notes: readonly string[];
}

interface Mapped {
  readonly body: FieldBody;
  readonly required: boolean;
  /** Nested entry types a matrix field produced, to hoist into the config's `entryTypes`. */
  readonly entryTypes: Record<string, { fields: FieldEntryOut[] }>;
  readonly notes: readonly string[];
}

interface FieldEntryOut {
  readonly handle: string;
  readonly required: boolean;
  readonly body: FieldBody;
}

/** `z.string().optional()` is a chain: peel the modifiers off to reach `z.string`, recording them. */
interface Peeled {
  readonly base: ts.CallExpression;
  /** Method names applied after the base: optional, default, max, … */
  readonly modifiers: readonly { name: string; args: readonly ts.Expression[] }[];
}

const peel = (expr: ts.Expression): Peeled | null => {
  const modifiers: { name: string; args: readonly ts.Expression[] }[] = [];
  let node: ts.Expression = expr;

  // Walk inwards through `.method(...)` calls until the callee is `z.<something>` itself.
  while (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const access = node.expression;
    const receiver = access.expression;

    // `z.string` / `z.coerce.date` — the receiver is `z` (or `z.coerce`). That is the base.
    const receiverText = receiver.getText();
    if (receiverText === 'z' || receiverText === 'z.coerce') break;

    modifiers.unshift({ name: access.name.text, args: [...node.arguments] });
    node = receiver;
  }

  return ts.isCallExpression(node) ? { base: node, modifiers } : null;
};

/** `z.string` → `string`, `z.coerce.date` → `date`. The Zod constructor being called. */
const baseName = (call: ts.CallExpression): string => {
  const callee = call.expression.getText();
  return callee.replace(/^z\.(coerce\.)?/, '');
};

const numberArg = (args: readonly ts.Expression[]): number | undefined => {
  const first = args[0];
  return first !== undefined && ts.isNumericLiteral(first) ? Number(first.text) : undefined;
};

const stringLiterals = (node: ts.Expression | undefined): string[] => {
  if (node === undefined || !ts.isArrayLiteralExpression(node)) return [];
  return node.elements.flatMap((element) => (ts.isStringLiteral(element) ? [element.text] : []));
};

/** `heading` from a `PropertyAssignment`, quoted or not. */
const propertyName = (property: ts.PropertyAssignment): string => {
  const name = property.name;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  return name.getText();
};

/** Drops a trailing plural `s` for a nested object's entry-type handle: relatedLinks → relatedLink. */
const singular = (handle: string): string => (handle.endsWith('s') ? handle.slice(0, -1) : handle);

/**
 * What the target CMS will not let a field be called, and who is asking.
 *
 * The importer stays CMS-neutral: it is handed the reserved handles rather than knowing them. The
 * CLI reads them off the adapter's capabilities, so a second CMS brings its own list and this file
 * does not change.
 */
interface Naming {
  /** The entry type these fields belong to — used to rename a handle the CMS has taken. */
  readonly owner: string;
  readonly reserved: ReadonlySet<string>;
}

/** `author` on `blog` → `blogAuthor`. Predictable, collision-free, and the config is yours to edit. */
const renamed = (owner: string, handle: string): string =>
  `${owner}${handle.charAt(0).toUpperCase()}${handle.slice(1)}`;

const mapField = (fieldHandle: string, expr: ts.Expression, naming: Naming): Mapped => {
  const peeled = peel(expr);

  if (peeled === null) {
    return {
      body: rawBody(expr),
      required: true,
      entryTypes: {},
      notes: [`"${fieldHandle}": could not be read as a Zod type, kept as raw.`],
    };
  }

  const modifierNames = new Set(peeled.modifiers.map((modifier) => modifier.name));
  // Zod fields are required unless one of these makes them not so.
  const required =
    !modifierNames.has('optional') &&
    !modifierNames.has('default') &&
    !modifierNames.has('nullable');
  const max = peeled.modifiers.find((modifier) => modifier.name === 'max');

  const base = baseName(peeled.base);

  switch (base) {
    case 'string':
      return field(
        max === undefined
          ? { type: 'text' }
          : {
              type: 'text',
              ...(numberArg(max.args) === undefined ? {} : { max: numberArg(max.args) }),
            },
        required,
      );
    case 'number':
      return field({ type: 'number' }, required);
    case 'boolean':
      return field({ type: 'boolean' }, required);
    case 'date':
      return field({ type: 'date' }, required);
    case 'enum': {
      const values = stringLiterals(peeled.base.arguments[0]);
      return values.length === 0
        ? {
            ...field(rawBody(expr), required),
            notes: [`"${fieldHandle}": empty enum, kept as raw.`],
          }
        : field(
            { type: 'dropdown', options: values.map((value) => ({ value, label: value })) },
            required,
          );
    }
    case 'array':
      return mapArray(fieldHandle, peeled.base, required, expr, naming);
    case 'object':
      return mapObject(fieldHandle, peeled.base, required, expr, naming);
    default:
      return {
        ...field(rawBody(expr), required),
        notes: [`"${fieldHandle}": z.${base}() has no LuminX field type, kept as raw.`],
      };
  }
};

const field = (body: FieldBody, required: boolean): Mapped => ({
  body,
  required,
  entryTypes: {},
  notes: [],
});

/** The escape hatch: the source text, so nothing is lost even when nothing maps. */
const rawBody = (expr: ts.Expression): FieldBody => ({
  type: 'raw',
  cms: { astro: { zod: expr.getText().replace(/\s+/g, ' ') } },
});

/** An object literal's properties, mapped to fields, with any deeper entry types it produced. */
/**
 * What every entry already is, before it has a single field of its own — the shape `LuminxEntry`
 * promises in the generated types (packages/codegen/src/types.ts).
 *
 * An Astro schema declares `title` because frontmatter has nowhere else to put one. A CMS entry has
 * one already, and Craft will not let you add a second: `handle: “title” is a reserved word`. We
 * used to emit the field anyway, which meant the flagship flow — import an Astro blog, stand a CMS
 * behind it — died mid-apply on the most ordinary schema anyone could write. Nearly every Astro
 * blog on earth begins `title: z.string()`.
 *
 * So these map onto what the entry already has, and we say so rather than dropping them in silence.
 */
const BUILT_IN_ENTRY_FIELDS = new Set(['id', 'title', 'slug', 'uri']);

const fieldsOf = (
  shape: ts.ObjectLiteralExpression,
  naming: Naming,
): {
  fields: FieldEntryOut[];
  entryTypes: Record<string, { fields: FieldEntryOut[] }>;
  notes: string[];
} => {
  const fields: FieldEntryOut[] = [];
  const entryTypes: Record<string, { fields: FieldEntryOut[] }> = {};
  const notes: string[] = [];

  for (const property of shape.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property);

    if (BUILT_IN_ENTRY_FIELDS.has(name)) {
      notes.push(`"${name}": every entry has one already, so it stays the entry's own ${name}.`);
      continue;
    }

    const mapped = mapField(name, property.initializer, naming);

    /**
     * A handle the CMS keeps for itself. Craft reserves `author`, `type`, `section`, `postDate` and
     * a few more on every entry — and `author: z.string()` is in half the Astro blogs there are.
     *
     * Renaming is lossy, so it is reported, and the config is a file the user owns: if `blogAuthor`
     * reads badly, they change it. The alternative — emitting the field as written — produced a
     * config that scaffolded a CMS and then died on the ninth write, which is the worst of both.
     */
    const handle = naming.reserved.has(name) ? renamed(naming.owner, name) : name;
    if (handle !== name) {
      notes.push(
        `"${name}": the CMS keeps this handle for itself, so it is imported as "${handle}".`,
      );
    }

    fields.push({ handle, required: mapped.required, body: mapped.body });
    Object.assign(entryTypes, mapped.entryTypes);
    notes.push(...mapped.notes);
  }

  return { fields, entryTypes, notes };
};

/** A matrix field over one generated entry type, plus that entry type and everything below it. */
const matrix = (
  entryTypeHandle: string,
  shape: ts.ObjectLiteralExpression,
  required: boolean,
  extra: { minEntries?: number; maxEntries?: number },
  note: (count: number) => string,
  naming: Naming,
): Mapped => {
  // A matrix block is an entry type too, so the same handles are off limits inside it — and the
  // block, not the section, is what a renamed field there belongs to.
  const inner = fieldsOf(shape, { owner: entryTypeHandle, reserved: naming.reserved });

  return {
    body: {
      type: 'matrix',
      entryTypes: [{ $ref: `#/entryTypes/${entryTypeHandle}` }],
      ...extra,
    },
    required,
    entryTypes: { ...inner.entryTypes, [entryTypeHandle]: { fields: inner.fields } },
    notes: [...inner.notes, note(inner.fields.length)],
  };
};

const mapArray = (
  fieldHandle: string,
  call: ts.CallExpression,
  required: boolean,
  original: ts.Expression,
  naming: Naming,
): Mapped => {
  const inner = call.arguments[0];
  const innerPeeled = inner === undefined ? null : peel(inner);
  const shape = innerPeeled?.base.arguments[0];

  // `z.array(z.object({...}))` is the one array shape a CMS models well: a matrix of one block.
  if (
    innerPeeled !== null &&
    baseName(innerPeeled.base) === 'object' &&
    shape !== undefined &&
    ts.isObjectLiteralExpression(shape)
  ) {
    const entryTypeHandle = singular(fieldHandle);
    return matrix(
      entryTypeHandle,
      shape,
      required,
      {},
      (count) =>
        `"${fieldHandle}": an array of objects became a matrix with entry type "${entryTypeHandle}" (${count} field(s)).`,
      naming,
    );
  }

  // A free list of scalars (`z.array(z.string())`) has no Craft equivalent. Do not pretend.
  return {
    ...field(rawBody(original), required),
    notes: [`"${fieldHandle}": a list of values has no CMS field type, kept as raw.`],
  };
};

const mapObject = (
  fieldHandle: string,
  call: ts.CallExpression,
  required: boolean,
  original: ts.Expression,
  naming: Naming,
): Mapped => {
  const shape = call.arguments[0];
  if (shape === undefined || !ts.isObjectLiteralExpression(shape)) {
    return {
      ...field(rawBody(original), required),
      notes: [`"${fieldHandle}": unreadable object, kept as raw.`],
    };
  }

  // A bare (non-array) object is a matrix that holds exactly one block.
  return matrix(
    fieldHandle,
    shape,
    required,
    { minEntries: 1, maxEntries: 1 },
    () => `"${fieldHandle}": a nested object became a single-entry matrix "${fieldHandle}".`,
    naming,
  );
};

/** Resolves `export const collections = { blog }` to each collection's `defineCollection` call. */
const collectionSchemas = (source: ts.SourceFile): Map<string, ts.ObjectLiteralExpression> => {
  const defineCalls = new Map<string, ts.ObjectLiteralExpression>(); // variable name → schema object
  const result = new Map<string, ts.ObjectLiteralExpression>(); // collection name → schema object

  const schemaOf = (call: ts.CallExpression): ts.ObjectLiteralExpression | null => {
    const config = call.arguments[0];
    if (config === undefined || !ts.isObjectLiteralExpression(config)) return null;

    for (const property of config.properties) {
      if (ts.isPropertyAssignment(property) && propertyName(property) === 'schema') {
        const schema = peel(property.initializer);
        const shape = schema?.base.arguments[0];
        if (shape !== undefined && ts.isObjectLiteralExpression(shape)) return shape;
      }
    }
    return null;
  };

  // First pass: every `const x = defineCollection({...})`.
  const walk = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      if (
        node.initializer.expression.getText() === 'defineCollection' &&
        ts.isIdentifier(node.name)
      ) {
        const schema = schemaOf(node.initializer);
        if (schema !== null) defineCalls.set(node.name.text, schema);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(source);

  // Second pass: `export const collections = { blog: blog, pages: pagesCollection, inline: defineCollection(...) }`.
  const readCollections = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'collections' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          const schema = defineCalls.get(property.name.text);
          if (schema !== undefined) result.set(property.name.text, schema);
        } else if (ts.isPropertyAssignment(property)) {
          const name = propertyName(property);
          if (ts.isIdentifier(property.initializer)) {
            const schema = defineCalls.get(property.initializer.text);
            if (schema !== undefined) result.set(name, schema);
          } else if (
            ts.isCallExpression(property.initializer) &&
            property.initializer.expression.getText() === 'defineCollection'
          ) {
            const schema = schemaOf(property.initializer);
            if (schema !== null) result.set(name, schema);
          }
        }
      }
    }
    ts.forEachChild(node, readCollections);
  };
  readCollections(source);

  return result;
};

export const importAstroContent = (
  source: string,
  cms = 'craft',
  /** The handles the target CMS keeps for itself, from its adapter's capabilities. */
  reservedHandles: Iterable<string> = [],
): Result<ImportResult, readonly LuminxError[]> => {
  const reserved = new Set(reservedHandles);
  const sourceFile = ts.createSourceFile('content.config.ts', source, ts.ScriptTarget.Latest, true);
  const collections = collectionSchemas(sourceFile);

  if (collections.size === 0) {
    return err([
      luminxError(ErrorCode.ConfigSchemaViolation, 'No Astro content collections found', {
        hint: 'Expected `export const collections = { … }` with `defineCollection({ schema: z.object({ … }) })`.',
      }),
    ]);
  }

  const entryTypes: Record<string, { fields: unknown[] }> = {};
  const sections: unknown[] = [];
  const notes: string[] = [];

  for (const [name, shape] of [...collections].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const collected = fieldsOf(shape, { owner: name, reserved });

    for (const [handle, entryType] of Object.entries(collected.entryTypes)) {
      entryTypes[handle] = { fields: entryType.fields.map(toConfigField) };
    }
    notes.push(...collected.notes.map((note) => `${name}: ${note}`));

    entryTypes[name] = { fields: collected.fields.map(toConfigField) };
    sections.push({
      handle: name,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      type: 'channel',
      entryTypes: [{ $ref: `#/entryTypes/${name}` }],
    });
  }

  const config = {
    $schema: 'https://luminx.dev/schema/v1.json',
    version: 1 as const,
    cms,
    entryTypes,
    sections,
  } as unknown as LuminxConfig;

  return ok({ config, notes });
};

/** A collected field back into the config's inline `$ref`-free shape. */
const toConfigField = (field: FieldEntryOut): Record<string, unknown> => ({
  handle: field.handle,
  ...(field.required ? { required: true } : {}),
  ...field.body,
});
