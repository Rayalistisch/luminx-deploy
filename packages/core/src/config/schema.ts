/**
 * Runtime validation at the edge (docs/architecture.md §13). Past this point the types are
 * trusted and nothing re-checks them.
 *
 * Every object is strict. An unrecognised key is a typo — `maxLevel` for `maxLevels`, say —
 * and silently ignoring it would leave the user staring at a CMS that did not do what their
 * config plainly says.
 *
 * Field shapes are declared once, as raw shapes, and used twice: bare in the reusable `fields`
 * map, and with handle and rename hint when written inline. Intersecting a strict object with
 * the body union cannot express that — a strict object rejects the very keys the other half
 * of the intersection supplies.
 */

import { z } from 'zod';

import type {
  EntryTypeConfig,
  FieldBody,
  FieldConfig,
  FieldEntry,
  LuminxConfig,
  Ref,
  ReusableFieldConfig,
} from './types.js';

/**
 * Handles address resources across the config, the lockfile and the CMS. Constraining them to
 * an identifier keeps them safe in every one of those places at once.
 */
const handle = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-zA-Z0-9_]*$/, 'must start with a lowercase letter, then letters, digits or _');

/**
 * `discriminatedUnion` wants a non-empty tuple, and `.map` yields an array. Rather than assert
 * the shape, check it: an empty variant list is a bug worth hearing about at import time.
 */
const nonEmpty = <T>(items: readonly T[]): [T, ...T[]] => {
  const [first, ...rest] = items;
  if (first === undefined) throw new TypeError('schema: a union needs at least one variant');
  return [first, ...rest];
};

/** Describes this use of a field, not the field itself: required here, optional there. */
const fieldUsage = {
  required: z.boolean().optional(),
  tab: z.string().min(1).optional(),
};

const RefSchema: z.ZodType<Ref> = z.strictObject({
  $ref: z.string().startsWith('#/', 'must be a local pointer, for example "#/fields/seoTitle"'),
  ...fieldUsage,
});

const selectOption = z.strictObject({
  value: z.string().min(1),
  label: z.string().min(1),
  default: z.boolean().optional(),
});

const tableColumn = z.strictObject({
  handle,
  heading: z.string().min(1),
  type: z.enum(['text', 'number', 'checkbox', 'date']),
});

const relationSources = {
  sources: z.array(handle).min(1),
  maxRelations: z.number().int().positive().optional(),
};

const named = {
  name: z.string().min(1).optional(),
  previousHandle: handle.optional(),
};

const renameable = { handle, ...named };

/**
 * Built fresh on every call so the recursive references inside `matrix` resolve lazily. A
 * module-level constant here would touch EntryTypeSchema before it exists.
 */
const fieldBodyShapes = () =>
  [
    {
      type: z.literal('text'),
      max: z.number().int().positive().optional(),
      multiline: z.boolean().optional(),
    },
    { type: z.literal('richtext') },
    {
      type: z.literal('number'),
      min: z.number().optional(),
      max: z.number().optional(),
      decimals: z.number().int().min(0).max(10).optional(),
    },
    { type: z.literal('boolean'), default: z.boolean().optional() },
    { type: z.literal('date'), showTime: z.boolean().optional() },
    { type: z.literal('dropdown'), options: z.array(selectOption).min(1) },
    { type: z.literal('multiselect'), options: z.array(selectOption).min(1) },
    { type: z.literal('assets'), ...relationSources },
    { type: z.literal('entries'), ...relationSources },
    { type: z.literal('categories'), ...relationSources },
    { type: z.literal('users'), ...relationSources },
    {
      type: z.literal('matrix'),
      entryTypes: z.array(z.union([EntryTypeSchema, RefSchema])).min(1),
      minEntries: z.number().int().min(0).optional(),
      maxEntries: z.number().int().positive().optional(),
    },
    { type: z.literal('table'), columns: z.array(tableColumn).min(1) },
    { type: z.literal('color') },
    { type: z.literal('money'), currency: z.string().length(3) },
    { type: z.literal('link') },
    // The escape hatch. Opaque by design: the core hashes it and hands it to the adapter.
    { type: z.literal('raw'), cms: z.record(z.string(), z.unknown()) },
  ] as const;

const FieldBodySchema: z.ZodType<FieldBody> = z.lazy(() =>
  z.discriminatedUnion('type', nonEmpty(fieldBodyShapes().map((shape) => z.strictObject(shape)))),
);

/** In the reusable map the record key is the handle, so only the rename hint rides along. */
const ReusableFieldSchema: z.ZodType<ReusableFieldConfig> = z.lazy(() =>
  z.discriminatedUnion(
    'type',
    nonEmpty(fieldBodyShapes().map((shape) => z.strictObject({ ...named, ...shape }))),
  ),
);

const FieldConfigSchema: z.ZodType<FieldConfig> = z.lazy(() =>
  z.discriminatedUnion(
    'type',
    nonEmpty(
      fieldBodyShapes().map((shape) => z.strictObject({ ...renameable, ...fieldUsage, ...shape })),
    ),
  ),
);

// A ref is checked first: `{ $ref }` is strict, so it can never swallow an inline field.
const FieldEntrySchema: z.ZodType<FieldEntry> = z.lazy(() =>
  z.union([RefSchema, FieldConfigSchema]),
);

const EntryTypeSchema: z.ZodType<EntryTypeConfig> = z.lazy(() =>
  z.strictObject({ ...renameable, fields: z.array(FieldEntrySchema) }),
);

const SectionSchema = z.strictObject({
  ...renameable,
  type: z.enum(['single', 'channel', 'structure']),
  entryTypes: z.array(z.union([EntryTypeSchema, RefSchema])).min(1),
  maxLevels: z.number().int().positive().optional(),
  uriFormat: z.string().optional(),
  template: z.string().optional(),
});

const FilesystemSchema = z.strictObject({
  ...renameable,
  type: z.string().min(1),
  path: z.string().min(1),
  url: z.string().optional(),
});

const VolumeSchema = z.strictObject({ ...renameable, fs: handle, subpath: z.string().optional() });

const CategorySchema = z.strictObject({
  ...renameable,
  maxLevels: z.number().int().positive().optional(),
  uriFormat: z.string().optional(),
  template: z.string().optional(),
});

const GlobalSetSchema = z.strictObject({ ...renameable, fields: z.array(FieldEntrySchema) });

const UserGroupSchema = z.strictObject({ ...renameable, permissions: z.array(z.string().min(1)) });

const NavigationSchema = z.strictObject({
  ...renameable,
  maxLevels: z.number().int().positive().optional(),
});

const SiteSchema = z.strictObject({
  handle,
  language: z.string().min(2),
  primary: z.boolean().optional(),
});

export const ConfigSchema: z.ZodType<LuminxConfig> = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1),
  cms: z.string().min(1),
  siteName: z.string().min(1).optional(),
  sites: z.array(SiteSchema).optional(),
  fields: z.record(handle, ReusableFieldSchema).optional(),
  entryTypes: z
    .record(handle, z.strictObject({ ...named, fields: z.array(FieldEntrySchema) }))
    .optional(),
  filesystems: z.array(FilesystemSchema).optional(),
  volumes: z.array(VolumeSchema).optional(),
  categories: z.array(CategorySchema).optional(),
  sections: z.array(SectionSchema).optional(),
  globals: z.array(GlobalSetSchema).optional(),
  userGroups: z.array(UserGroupSchema).optional(),
  navigation: z.array(NavigationSchema).optional(),
});
