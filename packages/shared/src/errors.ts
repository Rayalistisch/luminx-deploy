/**
 * Every failure LuminX can name. A closed set, because a documented error is a contract:
 * users grep for `LX1005`, scripts branch on it, and the docs have a section per code.
 *
 * The leading digit is the category, and the category is what the CLI turns into an exit
 * code (docs/architecture.md §8.6). That mapping lives in the CLI: this package knows what
 * went wrong, not what a process should do about it.
 */

export const ErrorCode = {
  // 1xxx — the config is wrong. Nothing was touched; fix the file.
  ConfigNotFound: 'LX1001',
  ConfigUnparsable: 'LX1002',
  ConfigSchemaViolation: 'LX1003',
  ConfigDuplicateHandle: 'LX1004',
  ConfigUnresolvedRef: 'LX1005',
  ConfigUnknownFieldType: 'LX1006',
  /** The field type is valid, but this adapter's `capabilities` do not include it (§7.1). */
  ConfigUnsupportedFieldType: 'LX1007',
  ConfigDependencyCycle: 'LX1008',
  /** `previousHandle` names a resource the lockfile has never seen (§5.2). */
  ConfigUnknownPreviousHandle: 'LX1009',
  ConfigConflictingFieldDefinition: 'LX1010',

  // 2xxx — the environment is wrong. The config may be fine; the machine is not.
  EnvRunnerNotFound: 'LX2001',
  EnvCmsNotDetected: 'LX2002',
  EnvPluginMissing: 'LX2003',
  EnvPluginDisabled: 'LX2004',
  /** The CMS refuses writes to its project config, so any apply would be a no-op (§9.3). */
  EnvAdminChangesDisabled: 'LX2005',
  EnvPendingProjectConfigChanges: 'LX2006',

  // 3xxx — the CLI and the CMS-side plugin disagree, or could not talk at all.
  ProtocolVersionMismatch: 'LX3001',
  ProtocolMalformedResponse: 'LX3002',
  ProtocolTransportFailure: 'LX3003',

  // 4xxx — a write failed. A snapshot exists; `luminx undo` is the way back (§10).
  ApplyOperationFailed: 'LX4001',
  ApplySnapshotFailed: 'LX4002',
  ApplyRestoreFailed: 'LX4003',
  /** The CMS drifted from the state the plan was computed against (§11.2). */
  ApplyBaseHashMismatch: 'LX4004',

  // 5xxx — a bug in LuminX. Nothing the user did causes these.
  InternalInvariantViolated: 'LX5001',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ErrorCategory = {
  Config: 'config',
  Environment: 'environment',
  Protocol: 'protocol',
  Apply: 'apply',
  Internal: 'internal',
} as const;

export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

const CATEGORY_BY_LEADING_DIGIT: Readonly<Record<string, ErrorCategory>> = {
  '1': ErrorCategory.Config,
  '2': ErrorCategory.Environment,
  '3': ErrorCategory.Protocol,
  '4': ErrorCategory.Apply,
  '5': ErrorCategory.Internal,
};

export const categoryOf = (code: ErrorCode): ErrorCategory => {
  const category = CATEGORY_BY_LEADING_DIGIT[code.charAt(2)];
  if (category === undefined) {
    throw new TypeError(`errors: ${code} has no category; the code table is inconsistent`);
  }
  return category;
};

/**
 * A failure, ready to render or to serialise across the wire.
 *
 * `pointer` is an RFC 6901 JSON pointer into the config (`/sections/0/entryTypes/1/handle`).
 * It is what turns "invalid config" into a line the editor can jump to.
 */
export interface LuminxError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly pointer?: string;
  /** What to do about it. Present whenever the fix is knowable. */
  readonly hint?: string;
  /** The resource this concerns, when the error is about one. */
  readonly logicalId?: string;
}

export const luminxError = (
  code: ErrorCode,
  message: string,
  details: Omit<LuminxError, 'code' | 'message'> = {},
): LuminxError => ({ code, message, ...details });
