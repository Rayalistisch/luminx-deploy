import { ErrorCode, luminxError } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { ExitCode, exitCodeFor, exitCodeForAll } from './exit.js';

const error = (code: ErrorCode) => luminxError(code, 'x');

describe('exitCodeFor', () => {
  it('maps each category to its documented code', () => {
    expect(exitCodeFor(error(ErrorCode.ConfigNotFound))).toBe(ExitCode.ConfigError);
    expect(exitCodeFor(error(ErrorCode.EnvPluginMissing))).toBe(ExitCode.EnvironmentError);
    expect(exitCodeFor(error(ErrorCode.ApplyOperationFailed))).toBe(ExitCode.ApplyFailed);
    expect(exitCodeFor(error(ErrorCode.InternalInvariantViolated))).toBe(ExitCode.InternalError);
  });

  // A plugin that speaks the wrong protocol is a fact about the machine, not the config.
  it('treats a protocol failure as an environment failure', () => {
    expect(exitCodeFor(error(ErrorCode.ProtocolVersionMismatch))).toBe(ExitCode.EnvironmentError);
  });
});

describe('exitCodeForAll', () => {
  it('is success for no errors', () => {
    expect(exitCodeForAll([])).toBe(ExitCode.Success);
  });

  // Otherwise a config error listed after an apply failure would hide it.
  it('lets the most severe error decide', () => {
    expect(
      exitCodeForAll([error(ErrorCode.ConfigNotFound), error(ErrorCode.ApplyOperationFailed)]),
    ).toBe(ExitCode.ApplyFailed);

    expect(
      exitCodeForAll([error(ErrorCode.ApplyOperationFailed), error(ErrorCode.ConfigNotFound)]),
    ).toBe(ExitCode.ApplyFailed);
  });
});
