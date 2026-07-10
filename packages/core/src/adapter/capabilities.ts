/**
 * Checks the compiled model against what the adapter can express (§7.1).
 *
 * This runs before a plan exists. A config asking for a field type this CMS lacks must fail as
 * a validation error, with a pointer, while nothing has been written — not as a crash halfway
 * through an apply, with half a content model in the database.
 */

import { ErrorCode, err, luminxError, ok } from '@luminx/shared';
import type { ContentModel, LuminxError, Result } from '@luminx/shared';

import type { Capabilities } from './contract.js';

export const checkCapabilities = (
  model: ContentModel,
  capabilities: Capabilities,
  adapterId: string,
): Result<void, readonly LuminxError[]> => {
  const kinds = new Set<string>(capabilities.resourceKinds);
  const fieldTypes = new Set<string>(capabilities.fieldTypes);
  const reserved = new Set<string>(capabilities.reservedFieldHandles ?? []);
  const errors: LuminxError[] = [];

  for (const resource of model.resources.values()) {
    if (resource.kind === 'field' && reserved.has(resource.handle)) {
      errors.push(
        luminxError(
          ErrorCode.ConfigReservedHandle,
          `"${adapterId}" reserves the field handle "${resource.handle}"`,
          {
            logicalId: resource.logicalId,
            hint: 'Rename the field to something the CMS does not use.',
          },
        ),
      );
      continue;
    }

    if (!kinds.has(resource.kind)) {
      errors.push(
        luminxError(
          ErrorCode.ConfigUnsupportedFieldType,
          `"${adapterId}" does not support ${resource.kind} resources`,
          { logicalId: resource.logicalId, hint: `Remove "${resource.handle}" from the config.` },
        ),
      );
      continue;
    }

    if (resource.kind === 'field' && !fieldTypes.has(resource.spec.type)) {
      errors.push(
        luminxError(
          ErrorCode.ConfigUnsupportedFieldType,
          `"${adapterId}" does not support the "${resource.spec.type}" field type`,
          {
            logicalId: resource.logicalId,
            hint: 'Use a supported type, or the `raw` escape hatch (§6).',
          },
        ),
      );
    }
  }

  return errors.length > 0 ? err(errors) : ok(undefined);
};
