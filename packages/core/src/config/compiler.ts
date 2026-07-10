/**
 * Config → IR (docs/architecture.md §3.2, §6).
 *
 * Three things happen here that the config format promises and the rest of LuminX relies on:
 *
 * - `$ref` is expanded, and one handle ends up with exactly one definition. Two definitions
 *   that disagree are an error, never "last one wins".
 * - Nested entry types are hoisted to top-level resources and deduplicated by handle, because
 *   entry types are globally reusable (§9.3). You may write them nested; they do not live there.
 * - `previousHandle` becomes a rename hint: new logicalId → old logicalId. The differ needs it
 *   to find the existing UID, since a handle rename changes the logicalId (§5.2).
 *
 * Errors accumulate. Fixing a config one message per run is how people come to hate a tool.
 */

import { hashOf } from '../hash.js';
import { ErrorCode, err, logicalIdOf, luminxError, ok } from '@luminx/shared';
import type {
  ContentModel,
  FieldLayoutEntry,
  FieldSpec,
  LogicalId,
  LuminxError,
  Resource,
  ResourceKind,
  Result,
} from '@luminx/shared';

import { pointerOf } from './pointer.js';
import { SOURCE_KIND, isRef } from './types.js';
import type {
  EntryTypeConfig,
  FieldBody,
  FieldEntry,
  LuminxConfig,
  Ref,
  ReusableEntryTypeConfig,
} from './types.js';

export interface CompiledModel {
  readonly cms: string;
  readonly model: ContentModel;
  /** New logicalId → the logicalId it used to have. Empty unless something was renamed. */
  readonly renames: ReadonlyMap<LogicalId, LogicalId>;
  /** Identifies *what* was compiled. Carried into the plan (§11.2). */
  readonly sourceHash: string;
}

/** Spreads a property only when it has a value, which `exactOptionalPropertyTypes` demands. */
const opt = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

/** `sitePages` → `Site Pages`. A label for editors, derived only when none was given. */
const humanize = (handle: string): string => {
  const spaced = handle.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** A reference resolved in phase 2. Not a dependency: these are what make the graph cyclic. */
interface Reference {
  readonly to: LogicalId;
  readonly pointer: string;
}

interface Context {
  readonly config: LuminxConfig;
  readonly resources: Map<LogicalId, Resource>;
  readonly renames: Map<LogicalId, LogicalId>;
  readonly references: Reference[];
  readonly errors: LuminxError[];
  /**
   * Entry types currently being resolved. An entry type whose matrix field contains that same
   * entry type is a definition that contains itself, and expanding it does not terminate.
   *
   * This is the only cycle a config can express. The `dependsOn` graph cannot contain one:
   * its edges run section → entryType → field and volume → filesystem, and fields depend on
   * nothing, because matrix and relation targets are phase-2 references rather than
   * dependencies (§8.3).
   */
  readonly resolving: Set<LogicalId>;
}

const fail = (context: Context, code: ErrorCode, message: string, pointer: string, hint?: string) =>
  context.errors.push(luminxError(code, message, { pointer, ...opt('hint', hint) }));

/**
 * Registers a resource, or reconciles it with one already registered under the same handle.
 *
 * Fields and entry types are expected to arrive more than once — that is what reuse means — so
 * an identical definition is a no-op and a differing one is an error. Every other kind is
 * written exactly once, so a second occurrence is a duplicate handle.
 */
const register = (context: Context, resource: Resource, pointer: string): LogicalId => {
  const existing = context.resources.get(resource.logicalId);

  if (existing === undefined) {
    context.resources.set(resource.logicalId, resource);
    return resource.logicalId;
  }

  const reusable = resource.kind === 'field' || resource.kind === 'entryType';

  if (!reusable) {
    fail(
      context,
      ErrorCode.ConfigDuplicateHandle,
      `Duplicate ${resource.kind} handle "${resource.handle}"`,
      pointer,
    );
  } else if (existing.hash !== resource.hash) {
    fail(
      context,
      ErrorCode.ConfigConflictingFieldDefinition,
      `${resource.kind} "${resource.handle}" is defined twice with different settings`,
      pointer,
      'Give one of them a different handle, or move the shared definition into the top-level "fields" or "entryTypes" map and reference it with $ref.',
    );
  }

  return resource.logicalId;
};

const recordRename = (
  context: Context,
  kind: ResourceKind,
  handle: string,
  previousHandle: string | undefined,
  pointer: string,
): void => {
  if (previousHandle === undefined) return;

  if (previousHandle === handle) {
    fail(
      context,
      ErrorCode.ConfigSchemaViolation,
      `previousHandle equals handle ("${handle}"), so nothing was renamed`,
      pointer,
      'Remove previousHandle.',
    );
    return;
  }

  context.renames.set(logicalIdOf(kind, handle), logicalIdOf(kind, previousHandle));
};

/** Records a reference for the existence check that runs once everything is registered. */
const reference = (context: Context, to: LogicalId, pointer: string): LogicalId => {
  context.references.push({ to, pointer });
  return to;
};

/** `#/fields/seoTitle` → `['fields', 'seoTitle']`. Returns null when the pointer is malformed. */
const refTarget = (ref: Ref): readonly [string, string] | null => {
  const segments = ref.$ref.slice(2).split('/');
  const [collection, name] = segments;
  if (segments.length !== 2 || collection === undefined || name === undefined) return null;
  return [collection, name];
};

const specOf = (context: Context, body: FieldBody, pointer: string): FieldSpec => {
  switch (body.type) {
    case 'text':
      return { type: 'text', ...opt('max', body.max), ...opt('multiline', body.multiline) };
    case 'richtext':
      return { type: 'richtext' };
    case 'number':
      return {
        type: 'number',
        ...opt('min', body.min),
        ...opt('max', body.max),
        ...opt('decimals', body.decimals),
      };
    case 'boolean':
      return { type: 'boolean', ...opt('default', body.default) };
    case 'date':
      return { type: 'date', ...opt('showTime', body.showTime) };
    case 'dropdown':
      return { type: 'dropdown', options: body.options.map(toOption) };
    case 'multiselect':
      return { type: 'multiselect', options: body.options.map(toOption) };
    case 'assets':
    case 'entries':
    case 'categories':
    case 'users': {
      const kind = SOURCE_KIND[body.type];
      // Relation sources are wired in phase 2, so they are references, not dependencies.
      const sources = body.sources.map((source, index) =>
        reference(context, logicalIdOf(kind, source), `${pointer}/sources/${index}`),
      );
      return { type: body.type, sources, ...opt('maxRelations', body.maxRelations) };
    }
    case 'matrix': {
      const entryTypes = body.entryTypes.map((entry, index) =>
        reference(
          context,
          resolveEntryType(context, entry, `${pointer}/entryTypes/${index}`),
          `${pointer}/entryTypes/${index}`,
        ),
      );
      return {
        type: 'matrix',
        entryTypes,
        ...opt('minEntries', body.minEntries),
        ...opt('maxEntries', body.maxEntries),
      };
    }
    case 'table':
      return { type: 'table', columns: body.columns.map((column) => ({ ...column })) };
    case 'color':
      return { type: 'color' };
    case 'money':
      return { type: 'money', currency: body.currency };
    case 'link':
      return { type: 'link' };
    case 'raw':
      return { type: 'raw', cms: body.cms };
  }
};

const toOption = (option: { value: string; label: string; default?: boolean | undefined }) => ({
  value: option.value,
  label: option.label,
  ...opt('default', option.default),
});

const registerField = (
  context: Context,
  handle: string,
  name: string | undefined,
  previousHandle: string | undefined,
  body: FieldBody,
  pointer: string,
): LogicalId => {
  const spec = specOf(context, body, pointer);
  recordRename(context, 'field', handle, previousHandle, pointer);

  // A matrix cannot be created without its entry types: a CMS may reject an empty one outright.
  // The edge is acyclic — a matrix nesting its own entry type is LX1008 — so ordering inside
  // phase 1 supplies them. A dependency, not wiring (§8.3, and the note in phases.ts).
  const dependsOn = spec.type === 'matrix' ? spec.entryTypes : [];

  return register(
    context,
    {
      kind: 'field',
      logicalId: logicalIdOf('field', handle),
      handle,
      name: name ?? humanize(handle),
      spec,
      dependsOn,
      hash: hashOf(spec),
    },
    pointer,
  );
};

/** Resolves one entry in a layout to the field it names, plus how it is used here. */
const resolveFieldEntry = (
  context: Context,
  entry: FieldEntry,
  pointer: string,
): FieldLayoutEntry | null => {
  if (isRef(entry)) {
    const target = refTarget(entry);
    if (target === null || target[0] !== 'fields') {
      fail(context, ErrorCode.ConfigUnresolvedRef, `Cannot resolve ${entry.$ref}`, pointer);
      return null;
    }

    const handle = target[1];
    const definition = context.config.fields?.[handle];
    if (definition === undefined) {
      fail(
        context,
        ErrorCode.ConfigUnresolvedRef,
        `${entry.$ref} names a field that does not exist`,
        pointer,
        `Define "${handle}" under the top-level "fields" map.`,
      );
      return null;
    }

    const { name, previousHandle, ...body } = definition;
    const definitionPointer = pointerOf(['fields', handle]);
    const field = registerField(
      context,
      handle,
      name,
      previousHandle,
      body as FieldBody,
      definitionPointer,
    );

    return { field, required: entry.required ?? false, ...opt('tab', entry.tab) };
  }

  const { handle, name, previousHandle, required, tab, ...body } = entry;
  const field = registerField(context, handle, name, previousHandle, body as FieldBody, pointer);

  return { field, required: required ?? false, ...opt('tab', tab) };
};

const layoutOf = (
  context: Context,
  fields: readonly FieldEntry[],
  pointer: string,
): readonly FieldLayoutEntry[] =>
  fields
    .map((entry, index) => resolveFieldEntry(context, entry, `${pointer}/fields/${index}`))
    .filter((entry): entry is FieldLayoutEntry => entry !== null);

const registerEntryType = (
  context: Context,
  handle: string,
  definition: ReusableEntryTypeConfig,
  pointer: string,
): LogicalId => {
  const logicalId = logicalIdOf('entryType', handle);

  // Without this the expansion never terminates and the process dies on a stack overflow
  // rather than telling the user which entry type ate itself.
  if (context.resolving.has(logicalId)) {
    fail(
      context,
      ErrorCode.ConfigDependencyCycle,
      `Entry type "${handle}" contains itself`,
      pointer,
      'A matrix field cannot nest the entry type it belongs to.',
    );
    return logicalId;
  }

  context.resolving.add(logicalId);
  const fields = layoutOf(context, definition.fields, pointer);
  context.resolving.delete(logicalId);

  const spec = { fields };
  recordRename(context, 'entryType', handle, definition.previousHandle, pointer);

  return register(
    context,
    {
      kind: 'entryType',
      logicalId: logicalIdOf('entryType', handle),
      handle,
      name: definition.name ?? humanize(handle),
      spec,
      // An entry type cannot be laid out before its fields exist.
      dependsOn: fields.map((entry) => entry.field),
      hash: hashOf(spec),
    },
    pointer,
  );
};

/** Written nested or referenced; either way it becomes one top-level resource. */
const resolveEntryType = (
  context: Context,
  entry: EntryTypeConfig | Ref,
  pointer: string,
): LogicalId => {
  if (isRef(entry)) {
    const target = refTarget(entry);
    if (target === null || target[0] !== 'entryTypes') {
      fail(context, ErrorCode.ConfigUnresolvedRef, `Cannot resolve ${entry.$ref}`, pointer);
      return logicalIdOf('entryType', '__unresolved__');
    }

    const handle = target[1];
    const definition = context.config.entryTypes?.[handle];
    if (definition === undefined) {
      fail(
        context,
        ErrorCode.ConfigUnresolvedRef,
        `${entry.$ref} names an entry type that does not exist`,
        pointer,
        `Define "${handle}" under the top-level "entryTypes" map.`,
      );
      return logicalIdOf('entryType', '__unresolved__');
    }

    return registerEntryType(context, handle, definition, pointerOf(['entryTypes', handle]));
  }

  return registerEntryType(context, entry.handle, entry, pointer);
};

const compileResources = (context: Context): void => {
  const { config } = context;

  config.filesystems?.forEach((fs, index) => {
    const pointer = pointerOf(['filesystems', index]);
    const spec = { type: fs.type, path: fs.path, ...opt('url', fs.url) };
    recordRename(context, 'filesystem', fs.handle, fs.previousHandle, pointer);
    register(
      context,
      {
        kind: 'filesystem',
        logicalId: logicalIdOf('filesystem', fs.handle),
        handle: fs.handle,
        name: fs.name ?? humanize(fs.handle),
        spec,
        dependsOn: [],
        hash: hashOf(spec),
      },
      pointer,
    );
  });

  config.volumes?.forEach((volume, index) => {
    const pointer = pointerOf(['volumes', index]);
    const fs = logicalIdOf('filesystem', volume.fs);
    const spec = { fs, ...opt('subpath', volume.subpath) };
    recordRename(context, 'volume', volume.handle, volume.previousHandle, pointer);
    register(
      context,
      {
        kind: 'volume',
        logicalId: logicalIdOf('volume', volume.handle),
        handle: volume.handle,
        name: volume.name ?? humanize(volume.handle),
        spec,
        // A volume cannot exist before the filesystem it writes to.
        dependsOn: [reference(context, fs, `${pointer}/fs`)],
        hash: hashOf(spec),
      },
      pointer,
    );
  });

  config.categories?.forEach((category, index) => {
    const pointer = pointerOf(['categories', index]);
    const spec = {
      ...opt('maxLevels', category.maxLevels),
      ...opt('uriFormat', category.uriFormat),
      ...opt('template', category.template),
    };
    recordRename(context, 'category', category.handle, category.previousHandle, pointer);
    register(
      context,
      {
        kind: 'category',
        logicalId: logicalIdOf('category', category.handle),
        handle: category.handle,
        name: category.name ?? humanize(category.handle),
        spec,
        dependsOn: [],
        hash: hashOf(spec),
      },
      pointer,
    );
  });

  config.sections?.forEach((section, index) => {
    const pointer = pointerOf(['sections', index]);
    const entryTypes = section.entryTypes.map((entry, entryIndex) =>
      resolveEntryType(context, entry, `${pointer}/entryTypes/${entryIndex}`),
    );
    const spec = {
      type: section.type,
      entryTypes,
      ...opt('maxLevels', section.maxLevels),
      ...opt('uriFormat', section.uriFormat),
      ...opt('template', section.template),
    };
    recordRename(context, 'section', section.handle, section.previousHandle, pointer);
    register(
      context,
      {
        kind: 'section',
        logicalId: logicalIdOf('section', section.handle),
        handle: section.handle,
        name: section.name ?? humanize(section.handle),
        spec,
        dependsOn: entryTypes,
        hash: hashOf(spec),
      },
      pointer,
    );
  });

  config.globals?.forEach((global, index) => {
    const pointer = pointerOf(['globals', index]);
    const fields = layoutOf(context, global.fields, pointer);
    const spec = { fields };
    recordRename(context, 'globalSet', global.handle, global.previousHandle, pointer);
    register(
      context,
      {
        kind: 'globalSet',
        logicalId: logicalIdOf('globalSet', global.handle),
        handle: global.handle,
        name: global.name ?? humanize(global.handle),
        spec,
        dependsOn: fields.map((entry) => entry.field),
        hash: hashOf(spec),
      },
      pointer,
    );
  });

  config.userGroups?.forEach((group, index) => {
    const pointer = pointerOf(['userGroups', index]);
    const spec = { permissions: [...group.permissions] };
    recordRename(context, 'userGroup', group.handle, group.previousHandle, pointer);
    register(
      context,
      {
        kind: 'userGroup',
        logicalId: logicalIdOf('userGroup', group.handle),
        handle: group.handle,
        name: group.name ?? humanize(group.handle),
        spec,
        dependsOn: [],
        hash: hashOf(spec),
      },
      pointer,
    );
  });

  config.navigation?.forEach((navigation, index) => {
    const pointer = pointerOf(['navigation', index]);
    const spec = { ...opt('maxLevels', navigation.maxLevels) };
    recordRename(context, 'navigation', navigation.handle, navigation.previousHandle, pointer);
    register(
      context,
      {
        kind: 'navigation',
        logicalId: logicalIdOf('navigation', navigation.handle),
        handle: navigation.handle,
        name: navigation.name ?? humanize(navigation.handle),
        spec,
        dependsOn: [],
        hash: hashOf(spec),
      },
      pointer,
    );
  });
};

/** Every reference must land on something. A dangling one is a config error, not a runtime one. */
const checkReferences = (context: Context): void => {
  for (const { to, pointer } of context.references) {
    if (!context.resources.has(to)) {
      const [kind, handle] = to.split(':');
      fail(
        context,
        ErrorCode.ConfigUnresolvedRef,
        `References ${kind} "${handle}", which is not defined`,
        pointer,
      );
    }
  }
};

export const compile = (config: LuminxConfig): Result<CompiledModel, readonly LuminxError[]> => {
  const context: Context = {
    config,
    resources: new Map(),
    renames: new Map(),
    references: [],
    errors: [],
    resolving: new Set(),
  };

  // There is no separate pass over `dependsOn` looking for cycles: that graph is a DAG by
  // construction (see Context.resolving). The one cycle a config can express is caught while
  // it is being expanded.
  compileResources(context);
  checkReferences(context);

  if (context.errors.length > 0) return err(context.errors);

  // Sorted, so the model — and every hash taken over it — never depends on config order.
  const sorted = [...context.resources.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const sourceHash = hashOf(sorted.map(([id, resource]) => [id, resource.hash]));

  return ok({
    cms: config.cms,
    model: { resources: new Map(sorted) },
    renames: new Map([...context.renames].sort(([a], [b]) => (a < b ? -1 : 1))),
    sourceHash,
  });
};
