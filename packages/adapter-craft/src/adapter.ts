/**
 * @luminx/adapter-craft — the only TypeScript package allowed to know about Craft CMS.
 *
 * It executes operations the core decided on; it never decides on one itself. That is what keeps
 * `--dry-run` honest: the plan you are shown is exactly the plan that runs.
 */

import { PROTOCOL_VERSION, ErrorCode, err, luminxError, ok } from '@luminx/shared';
import type { AdapterContext, Capabilities, CmsAdapter, CmsInfo } from '@luminx/core';
import type { CurrentModel, HealthCheck, LuminxError, ProjectFacts, Result } from '@luminx/shared';

import { createProtocolClient } from './protocol.js';
import type { Runner } from './runner.js';
import { toCurrentModel } from './translate.js';

export const CRAFT_ADAPTER_ID = 'craft';

const CMS_PACKAGE = 'craftcms/cms';
const PLUGIN_PACKAGE = 'luminx/craft-luminx';
/** Rich text is a first-party plugin, not core. Without it, `richtext` cannot be expressed. */
const RICHTEXT_PACKAGE = 'craftcms/ckeditor';
/** Craft has no navigation in core. The generator is provider-backed (§9.4). */
const NAVIGATION_PACKAGE = 'verbb/navigation';

const stripLeadingV = (version: string): string => version.replace(/^v/, '');

const installed = (facts: ProjectFacts, packageName: string): string | null =>
  facts.composer?.installed[packageName] ?? null;

/**
 * What this adapter can express, given what is actually installed.
 *
 * Capabilities are computed from the project rather than hard-coded, because two of them depend
 * on plugins. Checked before a plan exists (§7.1), so a config asking for `richtext` in a project
 * without CKEditor is a validation error with a pointer — not a crash halfway through an apply,
 * with half a content model in the database.
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
    resourceKinds:
      installed(facts, NAVIGATION_PACKAGE) === null
        ? resourceKinds
        : [...resourceKinds, 'navigation'],
  };
};

const notYet = (what: string): LuminxError =>
  luminxError(ErrorCode.ApplyOperationFailed, `${what} lands with M8.`, {
    hint: 'Until then, `luminx generate --dry-run` shows what would change.',
  });

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

    apply: () => Promise.resolve(err(notYet('Applying an operation'))),
    snapshot: () => Promise.resolve(err(notYet('Snapshots'))),
    restore: () => Promise.resolve(err(notYet('Restoring a snapshot'))),

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
