/**
 * Plugin JSON → the IR the differ compares against.
 *
 * The plugin sends resources without hashes on purpose. They are computed here, with the same
 * `hashOf` the compiler uses on the desired side, so both halves of every diff are hashed by one
 * implementation. A canonical serialiser in PHP would be a second chance to disagree, and one
 * byte of disagreement makes every resource look changed on every run.
 */

import { hashOf } from '@luminx/core';
import { ErrorCode, RESOURCE_KINDS, err, luminxError, ok } from '@luminx/shared';
import type { CurrentModel, CurrentResource, LuminxError, Resource, Result } from '@luminx/shared';

interface RawResource {
  readonly kind: string;
  readonly logicalId: string;
  readonly handle: string;
  readonly name: string;
  readonly spec: Record<string, unknown>;
  readonly dependsOn: readonly string[];
  readonly uid: string;
}

const KINDS = new Set<string>(RESOURCE_KINDS);

const isRawResource = (value: unknown): value is RawResource => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate['kind'] === 'string' &&
    typeof candidate['logicalId'] === 'string' &&
    typeof candidate['handle'] === 'string' &&
    typeof candidate['name'] === 'string' &&
    typeof candidate['uid'] === 'string' &&
    typeof candidate['spec'] === 'object' &&
    candidate['spec'] !== null &&
    Array.isArray(candidate['dependsOn'])
  );
};

/**
 * Turns the `{ resources: [...] }` payload into a CurrentModel.
 *
 * Everything is checked. The plugin is a separate artefact on a separate release cycle, and a
 * newer one sending a shape this CLI does not understand must say so rather than produce a
 * model that quietly omits half a content model — which the differ would read as "delete it all".
 */
export const toCurrentModel = (data: unknown): Result<CurrentModel, LuminxError> => {
  if (
    typeof data !== 'object' ||
    data === null ||
    !Array.isArray((data as { resources?: unknown }).resources)
  ) {
    return err(
      luminxError(ErrorCode.ProtocolMalformedResponse, 'The response carries no `resources` array'),
    );
  }

  const raw = (data as { resources: unknown[] }).resources;
  const resources = new Map<string, CurrentResource>();

  for (const entry of raw) {
    if (!isRawResource(entry)) {
      return err(
        luminxError(ErrorCode.ProtocolMalformedResponse, 'A resource is missing required fields', {
          hint: 'The plugin may be newer than this CLI. Check `luminx doctor`.',
        }),
      );
    }

    if (!KINDS.has(entry.kind)) {
      return err(
        luminxError(
          ErrorCode.ProtocolMalformedResponse,
          `The plugin reported an unknown resource kind "${entry.kind}"`,
          { logicalId: entry.logicalId },
        ),
      );
    }

    const resource = {
      kind: entry.kind,
      logicalId: entry.logicalId,
      handle: entry.handle,
      name: entry.name,
      spec: entry.spec,
      dependsOn: entry.dependsOn,
      hash: hashOf(entry.spec),
    } as Resource;

    resources.set(entry.logicalId, { resource, uid: entry.uid });
  }

  return ok({ resources });
};
