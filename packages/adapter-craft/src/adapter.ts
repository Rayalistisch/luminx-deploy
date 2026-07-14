/**
 * @luminx/adapter-craft — the only TypeScript package allowed to know about Craft CMS.
 *
 * It executes operations the core decided on; it never decides on one itself. That is what keeps
 * `--dry-run` honest: the plan you are shown is exactly the plan that runs.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PROTOCOL_VERSION, ErrorCode, err, luminxError, ok } from '@luminx/shared';
import type {
  AdapterContext,
  Capabilities,
  CmsAdapter,
  CmsInfo,
  ContentReport,
} from '@luminx/core';
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
import { scaffoldCraft } from './scaffold.js';
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
 * Handles Craft keeps for itself. A field named any of these fails Craft's own validation mid-save;
 * caught here, it fails before the plan with a pointer instead (§7.1). The adapter is allowed to
 * know Craft, so the list lives here.
 *
 * Craft enforces this in two places, and we long knew only the first:
 *
 *   1. `craft\base\Field::RESERVED_HANDLES` — every element, everywhere. The list below.
 *   2. `craft\models\EntryType::validate()`, which hands the field layout a *second* list
 *      (`author`, `section`, `type`, `postDate`, …) — the attributes an entry itself has.
 *
 * Missing the second cost a real run: `luminx import` on an Astro blog produced an `author` field,
 * the plan passed this check clean, Craft created the field happily, and then rejected the entry
 * type that used it — nine resources into the apply. `field:author` is legal; an entry *layout*
 * holding it is not.
 *
 * The two are merged rather than kept apart, because a LuminX field exists to be used, and nearly
 * every field lands in an entry type layout. A field named `author` used only in a global set would
 * be refused here though Craft would have taken it — an over-refusal, which costs a message. The
 * other direction costs a half-built CMS.
 */
const ENTRY_TYPE_RESERVED_HANDLES: readonly string[] = [
  // craft\models\EntryType::validate(), Craft 5.10.
  'author',
  'authorId',
  'authorIds',
  'authors',
  'postDate',
  'section',
  'sectionId',
  'type',
];

const FIELD_RESERVED_HANDLES: readonly string[] = [
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

/** Where Craft will answer GraphQL, once a route says so. */
const GRAPHQL_ENDPOINT = '/api';

const ROUTES_FILE = 'config/routes.php';

const ROUTES_TEMPLATE = `<?php
/**
 * Written by LuminX so the frontend can read this CMS (\`luminx client\`).
 *
 * Craft serves GraphQL only where a route points at it. Delete this and the read side goes dark.
 */
return [
    'api' => 'graphql/api',
];
`;

/**
 * Craft answers GraphQL at `/api` once `config/routes.php` sends it there — and not before.
 *
 * If the file is not there, we write it. If it *is* there, it is someone's file, and it may hold
 * routes this project depends on. Rewriting it to add one line is not a trade worth making, and
 * parsing PHP to edit it in place is worse. So we read it, and if it does not already route to
 * `graphql/api` we say exactly what to add and stop. A tool that quietly rewrites config it did not
 * write is a tool nobody can trust with a repository.
 */
const ensureGraphqlRoute = async (root: string): Promise<Result<void, LuminxError>> => {
  const path = join(root, ROUTES_FILE);

  let existing: string;
  try {
    existing = await readFile(path, 'utf8');
  } catch {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, ROUTES_TEMPLATE, 'utf8');
    return ok(undefined);
  }

  if (/graphql\/api/.test(existing)) return ok(undefined);

  return err(
    luminxError(ErrorCode.EnvCmsNotDetected, `${ROUTES_FILE} does not expose GraphQL`, {
      hint: `Add this to the array it returns, and run again:\n    'api' => 'graphql/api',`,
    }),
  );
};

/** Both lists Craft enforces, as one — see the note above. Sorted, so the capabilities are stable. */
const RESERVED_FIELD_HANDLES: readonly string[] = [
  ...new Set([...FIELD_RESERVED_HANDLES, ...ENTRY_TYPE_RESERVED_HANDLES]),
].sort();

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

    /**
     * Entries, in one call.
     *
     * `apply` deliberately sends one operation per call — each is a fresh Craft bootstrap, and a
     * failed write must not take the rest of a plan with it. Content is different: it is the same
     * kind of write repeated, there is nothing to order and nothing to roll back (this never
     * deletes), and a hundred posts would otherwise be a hundred Craft boots. So it goes in one.
     */
    pushContent: async (entries, context) => {
      const response = await client(context).call('luminx/content', { entries });
      if (!response.ok) return response;

      const report = response.value.data as ContentReport | undefined;

      return report === undefined || !Array.isArray(report.written)
        ? err(
            luminxError(
              ErrorCode.ApplyOperationFailed,
              'The plugin wrote content but reported nothing',
            ),
          )
        : ok(report);
    },

    /**
     * The read side: a scoped schema and a token, plus the route that exposes them.
     *
     * The plugin provisions the schema and the token — it is inside Craft, and only it can. But
     * Craft does not serve GraphQL until a *route* says so, and routes live in `config/routes.php`,
     * a file in the project. Files are the CLI's business, so that half happens here.
     */
    openReadSide: async (context) => {
      const routed = await ensureGraphqlRoute(context.root);
      if (!routed.ok) return routed;

      const response = await client(context).call('luminx/client', {});
      if (!response.ok) return response;

      const data = response.value.data as
        { token?: string; sections?: readonly string[]; url?: string } | undefined;

      return data?.token === undefined
        ? err(
            luminxError(
              ErrorCode.ApplyOperationFailed,
              'The plugin opened the read side but returned no token',
            ),
          )
        : ok({
            // Craft told us where it lives; we only know where it answers.
            endpoint: `${data.url ?? ''}${GRAPHQL_ENDPOINT}`,
            token: data.token,
            sections: data.sections ?? [],
          });
    },

    // The one method that runs before Craft exists, so it takes no AdapterContext (§ contract).
    scaffold: (scaffoldOptions, scaffoldContext) => scaffoldCraft(scaffoldOptions, scaffoldContext),

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
