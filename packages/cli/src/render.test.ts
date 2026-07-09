import { ErrorCode, luminxError } from '@luminx/shared';
import type { HealthCheck } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { paint, renderChecks, renderError, renderJson } from './render.js';

describe('paint', () => {
  it('wraps text in escape codes only when colour is on', () => {
    expect(paint(true, 'red', 'x')).toBe('[31mx[0m');
    expect(paint(false, 'red', 'x')).toBe('x');
  });
});

describe('renderError', () => {
  it('prints the code and message', () => {
    const text = renderError(false, luminxError(ErrorCode.ConfigNotFound, 'no config'));
    expect(text).toBe('✖ LX1001  no config\n');
  });

  it('adds the pointer and hint when they are known', () => {
    const text = renderError(
      false,
      luminxError(ErrorCode.ConfigUnresolvedRef, 'unknown ref', {
        pointer: '/sections/0',
        hint: 'Define it first.',
      }),
    );

    expect(text).toContain('at /sections/0');
    expect(text).toContain('Define it first.');
  });

  it('omits an empty pointer rather than printing "at "', () => {
    const text = renderError(false, luminxError(ErrorCode.ConfigNotFound, 'x', { pointer: '' }));
    expect(text).not.toContain('at ');
  });
});

describe('renderChecks', () => {
  const check = (status: HealthCheck['status']): HealthCheck => ({
    id: status,
    label: 'Label',
    status,
    detail: 'detail',
  });

  it('counts by status', () => {
    expect(renderChecks(false, [check('pass'), check('fail')])).toContain(
      '1 passed   0 warnings   1 failed',
    );
  });

  it('says "1 warning", not "1 warnings"', () => {
    expect(renderChecks(false, [check('warn')])).toContain('1 warning ');
  });
});

describe('renderJson', () => {
  it('ends with a newline so shells behave', () => {
    expect(renderJson({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});
