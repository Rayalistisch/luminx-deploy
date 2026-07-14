/**
 * @luminx/adapter-craft — the only TypeScript package allowed to know about Craft CMS.
 *
 * It executes operations the core decided on; it never decides on one itself. That is what keeps
 * `--dry-run` honest: the plan you are shown is exactly the plan that runs.
 */

import { PROTOCOL_VERSION, ErrorCode, err, luminxError, ok } from '@luminx/shared';
import type { AdapterContext, Capabilities, CmsAdapter, CmsInfo } from '@luminx/core';
import type {
  CurrentModel,
  HealthCheck,
  LogicalId,
  LuminxError,
  Operation,
  OperationResult,
  ProjectFacts,
  Result,
  SnapshotRef,
} from '@luminx/shared';

import { createProtocolClient } from './protocol.js';
import type { Runner } from './runner.js';
import { toCurrentModel } from './translate.js';

export const CRAFT_ADAPTER_ID = 'craft';

const CMS_PACKAGE = 'craftcms/cms';
const PLUGIN_PACKAGE = 'luminx/craft-luminx';
/** Rich text is a first-party plugin, not core. Without it, `richtext` cannot be expressed. */
const RICHTEXT_PACKAGE = 'craftcms/ckeditor';
/**
 * **Navigation is not supported.** Craft has no navigation in core; it needs a provider plugin
 * (`verbb/navigation`, §9.4), and §15 decision 5 planned it as the reference example for optional,
 * plugin-backed generators. It is not shipped, for two reasons that compound:
 *
 * - There is no NavigationGenerator in the plugin. This adapter claimed the capability anyway
 *   whenever the provider was installed, which meant a config using `navigation` would validate,
 *   plan, take a snapshot, and then die mid-apply on "no generator for this resource kind" —
 *   precisely the failure capabilities exist to prevent (§7.1). No test caught it, because no test
 *   installs the provider. `capabilities.test.ts` now holds the two lists to each other.
 * - The only Craft 5 release of the provider is `4.0.0-beta.3`. A generator built against a
 *   third-party beta API breaks when they change it before 4.0 stable.
 *
 * A config asking for `navigation` against Craft now fails with LX1007 before anything is written.
 * When a stable provider lands, the generator goes in the plugin and the capability follows.
 */

const stripLeadingV = (version: string): string => version.replace(/^v/, '');

const installed = (facts: ProjectFacts, packageName: string): string | null =>
  facts.composer?.installed[packageName] ?? null;

/**
 * Handles Craft keeps for itself, from `craft\\base\\Field::RESERVED_HANDLES`. A field named any
 * of these fails Craft's own validation mid-save; caught here, it fails before the plan with a
 * pointer instead (§7.1). The adapter is allowed to know Craft, so the list lives here — it is
 * duplicated knowledge, but a stale entry only means falling back to Craft's own mid-apply error,
 * which is safe.
 */
const RESERVED_FIELD_HANDLES: readonly string[] = [
  'ancestors',
  'applyingDraft',
  'archived',
  'attributeLabel',
  'attributes',
  'awaitingFieldValues',
  'behavior',
  'behaviors',
  'canSetProperties',
  'canonical',
  'children',
  'contentTable',
  'dateCreated',
  'dateDeleted',
  'dateLastMerged',
  'dateUpdated',
  'descendants',
  'draftId',
  'duplicateOf',
  'enabled',
  'enabledForSite',
  'error',
  'errorSummary',
  'errors',
  'fieldLayoutId',
  'fieldValue',
  'fieldValues',
  'firstSave',
  'hardDelete',
  'hasMethods',
  'icon',
  'id',
  'isNewForSite',
  'isProvisionalDraft',
  'language',
  'level',
  'lft',
  'link',
  'localized',
  'mergingCanonicalChanges',
  'newSiteIds',
  'next',
  'nextSibling',
  'owner',
  'parent',
  'parents',
  'prev',
  'prevSibling',
  'previewing',
  'propagateAll',
  'propagateRequired',
  'propagating',
  'ref',
  'relatedToAssets',
  'relatedToCategories',
  'relatedToEntries',
  'relatedToTags',
  'relatedToUsers',
  'resaving',
  'revisionId',
  'rgt',
  'root',
  'scenario',
  'searchKeywords',
  'searchScore',
  'siblings',
  'site',
  'siteId',
  'siteSettingsId',
  'slug',
  'sortOrder',
  'status',
  'structureId',
  'tempId',
  'title',
  'trashed',
  'uid',
  'updatingFromDerivative',
  'uri',
  'url',
  'viewMode',
  'where',
];

/**
 * What this adapter can express, given what is actually installed.
 *
 * Computed from the project rather than hard-coded, because two of these depend on plugins.
 * Checked before a plan exists (§7.1): a config asking for `richtext` without CKEditor, or a
 * field named `title`, is a validation error with a pointer — not a crash halfway through an
 * apply with half a content model written.
 */
export const capabilitiesFor = (facts: ProjectFacts): Capabilities => {
  const fieldTypes = [
    'text',
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
    // The escape hatch is always available: it is what `raw` is for.
    'raw',
  ] as const;

  const resourceKinds = [
    'filesystem',
    'volume',
    'field',
    'entryType',
    'section',
    'category',
    'globalSet',
    'userGroup',
  ] as const;

  return {
    fieldTypes:
      installed(facts, RICHTEXT_PACKAGE) === null ? fieldTypes : [...fieldTypes, 'richtext'],
    // `navigation` is deliberately absent, even where verbb/navigation is installed. See
    // NAVIGATION_PACKAGE above: there is no generator for it, and a capability the plugin cannot
    // deliver fails halfway through an apply — the one thing capabilities exist to prevent (§7.1).
    resourceKinds,
    reservedFieldHandles: RESERVED_FIELD_HANDLES,
  };
};

/**
 * The plugin applies a *list* of operations; the contract hands them over one at a time. Each
 * call is a fresh Craft bootstrap, and under DDEV also a wait for the volume to sync, so a plan
 * of eleven resources costs eleven of them.
 *
 * That is slow and it is correct. Batching would mean the adapter deciding which operations to
 * run together, and an adapter that decides anything breaks the promise `--dry-run` makes (§7.2).
 * If it needs fixing, it is the contract that changes, not this file.
 */
const singleOperation = (operation: Operation, resolved: ReadonlyMap<LogicalId, string>) => ({
  operations: [operation],
  resolved: Object.fromEntries(resolved),
});

const asSnapshotRef = (data: unknown): SnapshotRef | null => {
  if (typeof data !== 'object' || data === null) return null;
  const candidate = data as Record<string, unknown>;

  return typeof candidate['id'] === 'string'
    ? {
        id: candidate['id'],
        createdAt: typeof candidate['createdAt'] === 'string' ? candidate['createdAt'] : '',
        planHash: typeof candidate['planHash'] === 'string' ? candidate['planHash'] : '',
      }
    : null;
};

export interface CraftAdapterOptions {
  readonly runner: Runner;
  /**
   * Taken at construction because `capabilities` depends on them: whether `richtext` exists is a
   * fact about this project's plugins, not about Craft. An adapter built without facts would have
   * to claim something, and every answer it could claim would be wrong somewhere.
   */
  readonly facts: ProjectFacts;
  readonly onCommand?: (command: string) => void;
}

export const createCraftAdapter = (options: CraftAdapterOptions): CmsAdapter => {
  const client = (context: AdapterContext) =>
    createProtocolClient({
      root: context.root,
      runner: options.runner,
      ...(options.onCommand === undefined ? {} : { onCommand: options.onCommand }),
    });

  const detect = (context: AdapterContext): Promise<Result<CmsInfo, LuminxError>> => {
    const { facts } = context;

    // The lock file, never the constraint. `^5.0` is a wish; only the lock says what is there.
    const version = installed(facts, CMS_PACKAGE);

    if (version === null) {
      return Promise.resolve(
        err(
          luminxError(ErrorCode.EnvCmsNotDetected, 'This is not a Craft project', {
            hint:
              facts.composer === null
                ? 'No readable composer.json. Is this the project root?'
                : `${CMS_PACKAGE} is not installed. Run \`composer install\`.`,
          }),
        ),
      );
    }

    const plugin = installed(facts, PLUGIN_PACKAGE);

    if (plugin === null) {
      return Promise.resolve(
        err(
          luminxError(ErrorCode.EnvPluginMissing, `${PLUGIN_PACKAGE} is not installed`, {
            hint: `Run \`composer require ${PLUGIN_PACKAGE}\`.`,
          }),
        ),
      );
    }

    return Promise.resolve(
      ok({
        version: stripLeadingV(version),
        diagnostics: { craftVersion: stripLeadingV(version), pluginVersion: stripLeadingV(plugin) },
      }),
    );
  };

  return {
    id: CRAFT_ADAPTER_ID,
    protocolVersion: PROTOCOL_VERSION,

    capabilities: capabilitiesFor(options.facts),

    detect,

    introspect: async (context): Promise<Result<CurrentModel, LuminxError>> => {
      const response = await client(context).call('luminx/introspect', {});
      return response.ok ? toCurrentModel(response.value.data) : response;
    },

    apply: async (operation, context) => {
      const response = await client(context).call(
        'luminx/apply',
        singleOperation(operation, context.resolved),
      );

      if (!response.ok) return response;

      const results = (response.value.data as { results?: unknown })?.results;
      const first = Array.isArray(results)
        ? (results[0] as OperationResult | undefined)
        : undefined;

      return first === undefined
        ? err(
            luminxError(
              ErrorCode.InternalInvariantViolated,
              `The plugin applied ${operation.resource.logicalId} but reported no result`,
            ),
          )
        : ok(first);
    },

    snapshot: async (context) => {
      const response = await client(context).call('luminx/snapshot', { action: 'create' });
      if (!response.ok) return response;

      const ref = asSnapshotRef(response.value.data);

      return ref === null
        ? err(luminxError(ErrorCode.ApplySnapshotFailed, 'The plugin returned no snapshot id'))
        : ok(ref);
    },

    restore: async (ref, context) => {
      const response = await client(context).call('luminx/snapshot', {
        action: 'restore',
        id: ref.id,
      });

      return response.ok ? ok(undefined) : response;
    },

    listSnapshots: async (context) => {
      const response = await client(context).call('luminx/snapshot', { action: 'list' });
      if (!response.ok) return response;

      const raw = (response.value.data as { snapshots?: unknown })?.snapshots;
      const list = Array.isArray(raw) ? raw.map(asSnapshotRef) : [];

      return ok(list.filter((ref): ref is SnapshotRef => ref !== null));
    },

    healthChecks: async (context): Promise<readonly HealthCheck[]> => {
      const { facts } = context;
      const checks: HealthCheck[] = [];

      const craft = installed(facts, CMS_PACKAGE);
      checks.push({
        id: 'craft.installed',
        label: 'Craft CMS',
        status: craft === null ? 'fail' : 'pass',
        detail: craft === null ? 'not installed' : stripLeadingV(craft),
        ...(craft === null ? { fix: 'Run `composer install`.' } : {}),
      });

      const plugin = installed(facts, PLUGIN_PACKAGE);
      checks.push({
        id: 'craft.plugin',
        label: 'craft-luminx plugin',
        status: plugin === null ? 'fail' : 'pass',
        detail: plugin === null ? 'not installed' : stripLeadingV(plugin),
        ...(plugin === null ? { fix: `Run \`composer require ${PLUGIN_PACKAGE}\`.` } : {}),
      });

      checks.push({
        id: 'craft.runner',
        label: 'PHP runner',
        status: 'pass',
        detail: options.runner.describe(['luminx/introspect']),
      });

      // Installed is not enabled: Craft loads a plugin only once it has been installed *into*
      // the project. Asking it is the only way to know, and that means talking to it.
      if (plugin !== null) {
        const reachable = await client(context).call('luminx/introspect', {
          kinds: ['userGroup'],
        });

        checks.push({
          id: 'craft.reachable',
          label: 'Plugin responds',
          status: reachable.ok ? 'pass' : 'fail',
          detail: reachable.ok
            ? `protocol v${PROTOCOL_VERSION}`
            : `${reachable.error.code}: ${reachable.error.message}`,
          ...(reachable.ok
            ? {}
            : { fix: reachable.error.hint ?? 'Run `php craft plugin/install luminx`.' }),
        });
      }

      return checks;
    },
  };
};
