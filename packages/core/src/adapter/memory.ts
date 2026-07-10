/**
 * An adapter backed by a Map. It is what makes M5 testable end to end: `generate --dry-run`
 * runs against it with no PHP, no CMS and no database (§14, M5).
 *
 * It is a real implementation of the contract, not a mock. If the contract is awkward to
 * implement here, it will be worse to implement against a CMS, and that is worth learning now
 * rather than in M7.
 *
 * Naming no CMS, it is allowed to live in `core`.
 */

import { FIELD_TYPES, RESOURCE_KINDS, PROTOCOL_VERSION, ok } from '@luminx/shared';
import type { CurrentModel, CurrentResource, LogicalId, Resource } from '@luminx/shared';

import type { Capabilities, CmsAdapter } from './contract.js';

export const MEMORY_ADAPTER_ID = 'memory';

/** Everything the IR can say. A real CMS supports less, and says so here. */
const FULL_CAPABILITIES: Capabilities = {
  fieldTypes: FIELD_TYPES,
  resourceKinds: RESOURCE_KINDS,
};

export interface MemoryAdapterOptions {
  /** What the "CMS" already contains. Empty for a fresh install. */
  readonly initial?: readonly CurrentResource[];
  readonly capabilities?: Capabilities;
}

/** Deterministic, so a plan built against this adapter is reproducible in a test. */
const uidOf = (resource: Resource): string => `uid-${resource.logicalId.replace(':', '-')}`;

export const createMemoryAdapter = (options: MemoryAdapterOptions = {}): CmsAdapter => {
  const store = new Map<LogicalId, CurrentResource>(
    (options.initial ?? []).map((entry) => [entry.resource.logicalId, entry]),
  );

  const model = (): CurrentModel => ({ resources: new Map(store) });

  return {
    id: MEMORY_ADAPTER_ID,
    protocolVersion: PROTOCOL_VERSION,
    capabilities: options.capabilities ?? FULL_CAPABILITIES,

    detect: () => Promise.resolve(ok({ version: '0.0.0', diagnostics: { adapter: 'memory' } })),

    introspect: () => Promise.resolve(ok(model())),

    apply: (operation) => {
      const { resource } = operation;
      const uid = uidOf(resource);

      switch (operation.kind) {
        case 'create':
        case 'update':
          store.set(resource.logicalId, { resource, uid });
          return Promise.resolve(
            ok({
              logicalId: resource.logicalId,
              uid,
              status: operation.kind === 'create' ? ('created' as const) : ('updated' as const),
              warnings: [],
            }),
          );
        case 'delete':
          store.delete(resource.logicalId);
          return Promise.resolve(
            ok({
              logicalId: resource.logicalId,
              uid: operation.uid,
              status: 'deleted' as const,
              warnings: [],
            }),
          );
        case 'skip':
          return Promise.resolve(
            ok({ logicalId: resource.logicalId, uid, status: 'skipped' as const, warnings: [] }),
          );
      }
    },

    snapshot: () => Promise.resolve(ok({ id: 'memory', createdAt: '', planHash: '' })),
    restore: () => Promise.resolve(ok(undefined)),
    healthChecks: () => Promise.resolve([]),
  };
};

/** Builds a CurrentModel from resources, as a CMS that already holds them would report it. */
export const currentModelOf = (resources: readonly Resource[]): CurrentModel => ({
  resources: new Map(
    resources.map((resource) => [resource.logicalId, { resource, uid: uidOf(resource) }]),
  ),
});
