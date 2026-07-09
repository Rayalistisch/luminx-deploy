import { describe, expect, it } from 'vitest';

import { ErrorCategory, ErrorCode, categoryOf, luminxError } from './errors.js';

const codes = Object.values(ErrorCode);

describe('ErrorCode', () => {
  it('is a closed set of well-formed codes', () => {
    for (const code of codes) expect(code).toMatch(/^LX[1-5]\d{3}$/);
  });

  // A reused code makes two different failures indistinguishable to anyone grepping for it.
  it('assigns every code exactly once', () => {
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives every code a category', () => {
    for (const code of codes) expect(Object.values(ErrorCategory)).toContain(categoryOf(code));
  });

  it('derives the category from the leading digit', () => {
    expect(categoryOf(ErrorCode.ConfigNotFound)).toBe(ErrorCategory.Config);
    expect(categoryOf(ErrorCode.EnvPluginMissing)).toBe(ErrorCategory.Environment);
    expect(categoryOf(ErrorCode.ProtocolVersionMismatch)).toBe(ErrorCategory.Protocol);
    expect(categoryOf(ErrorCode.ApplyOperationFailed)).toBe(ErrorCategory.Apply);
    expect(categoryOf(ErrorCode.InternalInvariantViolated)).toBe(ErrorCategory.Internal);
  });

  it('rejects a code outside the table instead of guessing', () => {
    expect(() => categoryOf('LX9001' as ErrorCode)).toThrow(TypeError);
  });
});

describe('luminxError', () => {
  it('needs only a code and a message', () => {
    expect(luminxError(ErrorCode.ConfigNotFound, 'no config')).toEqual({
      code: 'LX1001',
      message: 'no config',
    });
  });

  it('carries the pointer and hint that make an error actionable', () => {
    const error = luminxError(ErrorCode.ConfigUnresolvedRef, 'unknown $ref', {
      pointer: '/sections/0/entryTypes/1/fields/0',
      hint: 'Define seoTitle under "fields" first.',
      logicalId: 'section:pages',
    });

    expect(error.pointer).toBe('/sections/0/entryTypes/1/fields/0');
    expect(error.hint).toBe('Define seoTitle under "fields" first.');
    expect(error.logicalId).toBe('section:pages');
  });
});
