/**
 * IR → config (docs/architecture.md §8.4, `init --from-existing`).
 *
 * The inverse of the compiler. It exists for one job: turn a CMS that already has a content model
 * into the `luminx.config.json` that describes it, so an existing project can adopt LuminX without
 * rebuilding by hand.
 *
 * It is also the sharpest test there is of introspection (§14, M11). The round-trip
 * introspect → decompile → compile → diff must be empty. If decompile and compile are true
 * inverses, a freshly-adopted project reports zero changes on its first `generate`; if they are
 * not, the difference is exactly the introspection bug, made visible.
 *
 * Names are always emitted, even when they equal what the compiler would derive from the handle.
 * Emitting them costs a few bytes and removes a way for the round-trip to drift.
 */

import type { FieldSpec, LogicalId, Resource } from '@luminx/shared';

import type {
  CategoryConfig,
  FieldEntry,
  FilesystemConfig,
  GlobalSetConfig,
  LuminxConfig,
  NavigationConfig,
  Ref,
  ReusableEntryTypeConfig,
  ReusableFieldConfig,
  SectionConfig,
  UserGroupConfig,
  VolumeConfig,
} from './types.js';

/** `volume:images` → `images`. The config speaks handles; the IR speaks logicalIds. */
const handleOf = (logicalId: LogicalId): string => logicalId.slice(logicalId.indexOf(':') + 1);

/** `field:heading` → `#/fields/heading`, `entryType:page` → `#/entryTypes/page`. */
const refTo = (collection: 'fields' | 'entryTypes', logicalId: LogicalId): Ref => ({
  $ref: `#/${collection}/${handleOf(logicalId)}`,
});

const omitUndefined = <T extends Record<string, unknown>>(object: T): T =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T;

/** The IR field spec back to the config's field body, with references turned into handles. */
const fieldBody = (spec: FieldSpec): Record<string, unknown> => {
  switch (spec.type) {
    case 'assets':
    case 'entries':
    case 'categories':
    case 'users':
      return omitUndefined({
        type: spec.type,
        sources: spec.sources.map(handleOf),
        maxRelations: spec.maxRelations,
      });
    case 'matrix':
      return omitUndefined({
        type: 'matrix',
        entryTypes: spec.entryTypes.map((id) => refTo('entryTypes', id)),
        minEntries: spec.minEntries,
        maxEntries: spec.maxEntries,
      });
    default:
      // Every other field type is scalar settings only — no references to rewrite.
      return { ...spec };
  }
};

/** One entry in a field layout, as a $ref plus how the field is used here. */
const layoutEntry = (entry: { field: LogicalId; required: boolean; tab?: string }): FieldEntry =>
  omitUndefined({
    ...refTo('fields', entry.field),
    required: entry.required,
    tab: entry.tab,
  }) as FieldEntry;

/**
 * Takes the resources directly, not a model, so both a `ContentModel` (via `.resources.values()`)
 * and a `CurrentModel` (via its resources' `.resource`) decompile the same way.
 */
export const decompile = (cms: string, resources: Iterable<Resource>): LuminxConfig => {
  const fields: Record<string, ReusableFieldConfig> = {};
  const entryTypes: Record<string, ReusableEntryTypeConfig> = {};
  const filesystems: FilesystemConfig[] = [];
  const volumes: VolumeConfig[] = [];
  const categories: CategoryConfig[] = [];
  const sections: SectionConfig[] = [];
  const globals: GlobalSetConfig[] = [];
  const userGroups: UserGroupConfig[] = [];
  const navigation: NavigationConfig[] = [];

  // Sorted, so the same CMS produces the same config file byte for byte (§13).
  const sorted = [...resources].sort((a, b) => (a.logicalId < b.logicalId ? -1 : 1));

  for (const resource of sorted) {
    switch (resource.kind) {
      case 'field':
        fields[resource.handle] = {
          name: resource.name,
          ...fieldBody(resource.spec),
        } as ReusableFieldConfig;
        break;

      case 'entryType':
        entryTypes[resource.handle] = {
          name: resource.name,
          fields: resource.spec.fields.map(layoutEntry),
        };
        break;

      case 'filesystem':
        filesystems.push(
          omitUndefined({ handle: resource.handle, name: resource.name, ...resource.spec }),
        );
        break;

      case 'volume':
        volumes.push(
          omitUndefined({
            handle: resource.handle,
            name: resource.name,
            fs: handleOf(resource.spec.fs),
            subpath: resource.spec.subpath,
          }),
        );
        break;

      case 'category':
        categories.push(
          omitUndefined({ handle: resource.handle, name: resource.name, ...resource.spec }),
        );
        break;

      case 'section':
        sections.push(
          omitUndefined({
            handle: resource.handle,
            name: resource.name,
            type: resource.spec.type,
            entryTypes: resource.spec.entryTypes.map((id) => refTo('entryTypes', id)),
            maxLevels: resource.spec.maxLevels,
            uriFormat: resource.spec.uriFormat,
            template: resource.spec.template,
          }),
        );
        break;

      case 'globalSet':
        globals.push({
          handle: resource.handle,
          name: resource.name,
          fields: resource.spec.fields.map(layoutEntry),
        });
        break;

      case 'userGroup':
        userGroups.push({
          handle: resource.handle,
          name: resource.name,
          permissions: [...resource.spec.permissions],
        });
        break;

      case 'navigation':
        navigation.push(
          omitUndefined({ handle: resource.handle, name: resource.name, ...resource.spec }),
        );
        break;
    }
  }

  // Only the collections that have something go into the file, so the output stays the shape a
  // human would have written rather than a wall of empty arrays.
  return omitUndefined({
    $schema: 'https://luminx.dev/schema/v1.json',
    version: 1,
    cms,
    fields: Object.keys(fields).length > 0 ? fields : undefined,
    entryTypes: Object.keys(entryTypes).length > 0 ? entryTypes : undefined,
    filesystems: filesystems.length > 0 ? filesystems : undefined,
    volumes: volumes.length > 0 ? volumes : undefined,
    categories: categories.length > 0 ? categories : undefined,
    sections: sections.length > 0 ? sections : undefined,
    globals: globals.length > 0 ? globals : undefined,
    userGroups: userGroups.length > 0 ? userGroups : undefined,
    navigation: navigation.length > 0 ? navigation : undefined,
  }) as LuminxConfig;
};
