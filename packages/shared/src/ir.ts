/**
 * The Intermediate Representation: a CMS-neutral description of a content model, and the
 * contract between the core and every adapter (docs/architecture.md §6).
 *
 * The IR is deliberately poorer than any CMS it targets. It expresses what a serious CMS can
 * express, and nothing more. That poverty is the reason a second adapter is a new package
 * rather than a rewrite of the differ.
 */

/**
 * A stable, config-derived identity: `'section:pages'`, `'field:heroImage'`.
 *
 * Derived from kind and handle, which is why renaming a handle changes the logicalId — and
 * why a rename needs `previousHandle` to point the differ at the old key (§5.2).
 */
export type LogicalId = string;

export const RESOURCE_KINDS = [
  'filesystem',
  'volume',
  'field',
  'entryType',
  'section',
  'category',
  'globalSet',
  'userGroup',
  'navigation',
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const logicalIdOf = (kind: ResourceKind, handle: string): LogicalId => `${kind}:${handle}`;

export const FIELD_TYPES = [
  'text',
  'richtext',
  'number',
  'boolean',
  'date',
  'dropdown',
  'multiselect',
  'assets',
  'entries',
  'categories',
  'users',
  'matrix',
  'table',
  'color',
  'money',
  'link',
  'raw',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly default?: boolean;
}

export interface TableColumn {
  readonly handle: string;
  readonly heading: string;
  readonly type: 'text' | 'number' | 'checkbox' | 'date';
}

/** A relation field points at other resources by logicalId, never by handle or UID. */
interface RelationSpec {
  readonly sources: readonly LogicalId[];
  readonly maxRelations?: number;
}

export type FieldSpec =
  | { readonly type: 'text'; readonly max?: number; readonly multiline?: boolean }
  | { readonly type: 'richtext' }
  | {
      readonly type: 'number';
      readonly min?: number;
      readonly max?: number;
      readonly decimals?: number;
    }
  | { readonly type: 'boolean'; readonly default?: boolean }
  | { readonly type: 'date'; readonly showTime?: boolean }
  | { readonly type: 'dropdown'; readonly options: readonly SelectOption[] }
  | { readonly type: 'multiselect'; readonly options: readonly SelectOption[] }
  | ({ readonly type: 'assets' } & RelationSpec)
  | ({ readonly type: 'entries' } & RelationSpec)
  | ({ readonly type: 'categories' } & RelationSpec)
  | ({ readonly type: 'users' } & RelationSpec)
  | {
      readonly type: 'matrix';
      /** Entry types are top-level resources, so a matrix references them (§9.3). */
      readonly entryTypes: readonly LogicalId[];
      readonly minEntries?: number;
      readonly maxEntries?: number;
    }
  | { readonly type: 'table'; readonly columns: readonly TableColumn[] }
  | { readonly type: 'color' }
  | { readonly type: 'money'; readonly currency: string }
  | { readonly type: 'link' }
  | {
      /**
       * The escape hatch (§6). Keyed by adapter id, because naming a CMS here would put
       * CMS knowledge in the one package that must not have any — `pnpm check:purity`
       * enforces exactly that. The core never reads inside; it hashes it and hands it over.
       *
       * It is meant to look unpleasant. Reach for it only when the IR genuinely cannot say
       * what you mean.
       */
      readonly type: 'raw';
      readonly cms: Readonly<Record<string, unknown>>;
    };

/** One field's placement in an entry type's layout. Order is significant and preserved. */
export interface FieldLayoutEntry {
  readonly field: LogicalId;
  readonly required: boolean;
  /** Tab label. Absent means the first, default tab. */
  readonly tab?: string;
}

export interface FilesystemSpec {
  readonly type: string;
  readonly path: string;
  readonly url?: string;
}

export interface VolumeSpec {
  readonly fs: LogicalId;
  readonly subpath?: string;
}

export interface EntryTypeSpec {
  readonly fields: readonly FieldLayoutEntry[];
}

export interface SectionSpec {
  readonly type: 'single' | 'channel' | 'structure';
  readonly entryTypes: readonly LogicalId[];
  readonly maxLevels?: number;
  readonly uriFormat?: string;
  readonly template?: string;
}

export interface CategorySpec {
  readonly maxLevels?: number;
  readonly uriFormat?: string;
  readonly template?: string;
}

export interface GlobalSetSpec {
  readonly fields: readonly FieldLayoutEntry[];
}

export interface UserGroupSpec {
  readonly permissions: readonly string[];
}

/**
 * Navigation has no home in any CMS core we target; a provider plugin supplies it. Marked
 * experimental in v1 — the value is the provider pattern, not the feature (§9.4).
 */
export interface NavigationSpec {
  readonly maxLevels?: number;
}

interface ResourceOf<K extends ResourceKind, S> {
  readonly kind: K;
  readonly logicalId: LogicalId;
  readonly handle: string;
  readonly name: string;
  readonly spec: S;
  /** logicalIds this resource must exist after. Phase-2 references are not dependencies. */
  readonly dependsOn: readonly LogicalId[];
  /** sha256 of the canonical form of `spec`. Equal hash means skip, without a round-trip. */
  readonly hash: string;
}

export type Resource =
  | ResourceOf<'filesystem', FilesystemSpec>
  | ResourceOf<'volume', VolumeSpec>
  | ResourceOf<'field', FieldSpec>
  | ResourceOf<'entryType', EntryTypeSpec>
  | ResourceOf<'section', SectionSpec>
  | ResourceOf<'category', CategorySpec>
  | ResourceOf<'globalSet', GlobalSetSpec>
  | ResourceOf<'userGroup', UserGroupSpec>
  | ResourceOf<'navigation', NavigationSpec>;

export type ResourceSpec = Resource['spec'];

/** What the config asks for. Has no UIDs: those exist only once a CMS has created something. */
export interface ContentModel {
  readonly resources: ReadonlyMap<LogicalId, Resource>;
}

/** A resource as the CMS reports it: the IR shape, plus the UID the CMS assigned it. */
export interface CurrentResource {
  readonly resource: Resource;
  readonly uid: string;
}

/** What the CMS actually has. The other half of every diff. */
export interface CurrentModel {
  readonly resources: ReadonlyMap<LogicalId, CurrentResource>;
}
