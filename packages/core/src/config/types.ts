/**
 * The shape of `luminx.config.json` as written by a human — not the shape the rest of LuminX
 * reasons about. The compiler turns this into the IR (docs/architecture.md §6).
 *
 * Optionals are declared `?: T | undefined` rather than `?: T` because `exactOptionalPropertyTypes`
 * is on and this is what Zod's `.optional()` produces. Writing `?: T` here would make every
 * schema fail to typecheck against its own interface.
 */

import type { ResourceKind } from '@luminx/shared';

/**
 * A pointer into the config's own reusable definitions: `#/fields/seoTitle`.
 *
 * `required` and `tab` ride along because they describe this *use* of the field, not the field.
 * The same field is required in one entry type and optional in another.
 */
export interface Ref {
  readonly $ref: string;
  readonly required?: boolean | undefined;
  readonly tab?: string | undefined;
}

export const isRef = (value: unknown): value is Ref =>
  typeof value === 'object' && value !== null && '$ref' in value;

export interface SelectOptionConfig {
  readonly value: string;
  readonly label: string;
  readonly default?: boolean | undefined;
}

export interface TableColumnConfig {
  readonly handle: string;
  readonly heading: string;
  readonly type: 'text' | 'number' | 'checkbox' | 'date';
}

/**
 * Present on any resource whose `handle` changed since the last apply. The compiler resolves
 * it to the previous logicalId so the differ finds the existing UID and emits an update
 * instead of a destructive recreate (§5.2). It is an instruction, not state: remove it once
 * the rename has been applied.
 */
interface Named {
  readonly name?: string | undefined;
  readonly previousHandle?: string | undefined;
}

interface Renameable extends Named {
  readonly handle: string;
}

/** How a field is used at one site in a layout, as opposed to what the field is. */
interface FieldUsage {
  readonly required?: boolean | undefined;
  readonly tab?: string | undefined;
}

/** Everything about a field except which handle it answers to. */
export type FieldBody =
  | {
      readonly type: 'text';
      readonly max?: number | undefined;
      readonly multiline?: boolean | undefined;
    }
  | { readonly type: 'richtext' }
  | {
      readonly type: 'number';
      readonly min?: number | undefined;
      readonly max?: number | undefined;
      readonly decimals?: number | undefined;
    }
  | { readonly type: 'boolean'; readonly default?: boolean | undefined }
  | { readonly type: 'date'; readonly showTime?: boolean | undefined }
  | { readonly type: 'dropdown'; readonly options: readonly SelectOptionConfig[] }
  | { readonly type: 'multiselect'; readonly options: readonly SelectOptionConfig[] }
  | {
      readonly type: 'assets';
      /** Volume handles. */
      readonly sources: readonly string[];
      readonly maxRelations?: number | undefined;
    }
  | {
      readonly type: 'entries';
      /** Section handles. */
      readonly sources: readonly string[];
      readonly maxRelations?: number | undefined;
    }
  | {
      readonly type: 'categories';
      /** Category group handles. */
      readonly sources: readonly string[];
      readonly maxRelations?: number | undefined;
    }
  | {
      readonly type: 'users';
      /** User group handles. */
      readonly sources: readonly string[];
      readonly maxRelations?: number | undefined;
    }
  | {
      readonly type: 'matrix';
      /** Written inline or referenced; either way the compiler hoists them (§9.3). */
      readonly entryTypes: readonly (EntryTypeConfig | Ref)[];
      readonly minEntries?: number | undefined;
      readonly maxEntries?: number | undefined;
    }
  | { readonly type: 'table'; readonly columns: readonly TableColumnConfig[] }
  | { readonly type: 'color' }
  | { readonly type: 'money'; readonly currency: string }
  | { readonly type: 'link' }
  | { readonly type: 'raw'; readonly cms: Readonly<Record<string, unknown>> };

/** A field written inline at the point of use. */
export type FieldConfig = Renameable & FieldUsage & FieldBody;

/** A field in the reusable `fields` map, where the record key supplies the handle. */
export type ReusableFieldConfig = Named & FieldBody;

/** A field inside a layout: written inline, or referenced from the reusable `fields` map. */
export type FieldEntry = FieldConfig | Ref;

export interface EntryTypeConfig extends Renameable {
  readonly fields: readonly FieldEntry[];
}

/** An entry type in the reusable `entryTypes` map. */
export interface ReusableEntryTypeConfig extends Named {
  readonly fields: readonly FieldEntry[];
}

export interface SectionConfig extends Renameable {
  readonly type: 'single' | 'channel' | 'structure';
  readonly entryTypes: readonly (EntryTypeConfig | Ref)[];
  readonly maxLevels?: number | undefined;
  readonly uriFormat?: string | undefined;
  readonly template?: string | undefined;
}

export interface FilesystemConfig extends Renameable {
  readonly type: string;
  readonly path: string;
  readonly url?: string | undefined;
}

export interface VolumeConfig extends Renameable {
  /** Filesystem handle. */
  readonly fs: string;
  readonly subpath?: string | undefined;
}

export interface CategoryConfig extends Renameable {
  readonly maxLevels?: number | undefined;
  readonly uriFormat?: string | undefined;
  readonly template?: string | undefined;
}

export interface GlobalSetConfig extends Renameable {
  readonly fields: readonly FieldEntry[];
}

export interface UserGroupConfig extends Renameable {
  readonly permissions: readonly string[];
}

export interface NavigationConfig extends Renameable {
  readonly maxLevels?: number | undefined;
}

export interface SiteConfig {
  readonly handle: string;
  readonly language: string;
  readonly primary?: boolean | undefined;
}

export interface LuminxConfig {
  readonly $schema?: string | undefined;
  readonly version: 1;
  /** Adapter id. The core never interprets this; it hands it to the registry. */
  readonly cms: string;
  readonly siteName?: string | undefined;
  /**
   * Accepted and validated, but not yet compiled: sites are not a ResourceKind in v1. Kept in
   * the schema so a config written against the documented example does not fail on an
   * unrecognised key.
   */
  readonly sites?: readonly SiteConfig[] | undefined;
  /** Reusable definitions, addressed as `#/fields/<handle>`. */
  readonly fields?: Readonly<Record<string, ReusableFieldConfig>> | undefined;
  /** Reusable definitions, addressed as `#/entryTypes/<handle>`. */
  readonly entryTypes?: Readonly<Record<string, ReusableEntryTypeConfig>> | undefined;
  readonly filesystems?: readonly FilesystemConfig[] | undefined;
  readonly volumes?: readonly VolumeConfig[] | undefined;
  readonly categories?: readonly CategoryConfig[] | undefined;
  readonly sections?: readonly SectionConfig[] | undefined;
  readonly globals?: readonly GlobalSetConfig[] | undefined;
  readonly userGroups?: readonly UserGroupConfig[] | undefined;
  readonly navigation?: readonly NavigationConfig[] | undefined;
}

/**
 * Which resource kind a relation field's `sources` name.
 *
 * Keyed by the exact four field types that have sources, not by `string`: a `string` key would
 * make every lookup possibly-undefined and invite a fallback, and a fallback here is a wrong
 * answer wearing a default's clothing.
 */
export const SOURCE_KIND = {
  assets: 'volume',
  entries: 'section',
  categories: 'category',
  users: 'userGroup',
} as const satisfies Record<string, ResourceKind>;
