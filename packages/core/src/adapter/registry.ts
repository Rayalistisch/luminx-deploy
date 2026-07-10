/**
 * Adapters, by the `cms` key in the config (§3.2). Only the CLI ever registers one: it is the
 * composition root, and this is the seam that keeps every CMS name out of this package.
 */

import { ErrorCode, err, luminxError, ok } from '@luminx/shared';
import type { LuminxError, Result } from '@luminx/shared';

import type { CmsAdapter } from './contract.js';

export interface AdapterRegistry {
  readonly register: (adapter: CmsAdapter) => void;
  readonly resolve: (id: string) => Result<CmsAdapter, LuminxError>;
  readonly ids: () => readonly string[];
}

export const createRegistry = (adapters: readonly CmsAdapter[] = []): AdapterRegistry => {
  const byId = new Map<string, CmsAdapter>(adapters.map((adapter) => [adapter.id, adapter]));

  return {
    register: (adapter) => void byId.set(adapter.id, adapter),

    resolve: (id) => {
      const adapter = byId.get(id);
      if (adapter !== undefined) return ok(adapter);

      const known = [...byId.keys()].sort();
      return err(
        luminxError(ErrorCode.EnvCmsNotDetected, `No adapter for cms "${id}"`, {
          pointer: '/cms',
          hint:
            known.length === 0
              ? 'No adapters are registered.'
              : `Known adapters: ${known.join(', ')}.`,
        }),
      );
    },

    ids: () => [...byId.keys()].sort(),
  };
};
