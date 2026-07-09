/**
 * Turning values into the text a person reads. No logic lives here beyond presentation.
 */

import type { HealthCheck, HealthStatus, LuminxError } from '@luminx/shared';

const CODES = {
  reset: '[0m',
  dim: '[2m',
  red: '[31m',
  green: '[32m',
  yellow: '[33m',
  bold: '[1m',
} as const;

export type Style = keyof Omit<typeof CODES, 'reset'>;

export const paint = (color: boolean, style: Style, text: string): string =>
  color ? `${CODES[style]}${text}${CODES.reset}` : text;

const STATUS_STYLE: Readonly<Record<HealthStatus, Style>> = {
  pass: 'green',
  warn: 'yellow',
  fail: 'red',
};

const STATUS_MARK: Readonly<Record<HealthStatus, string>> = {
  pass: '✔',
  warn: '!',
  fail: '✖',
};

/**
 * An error is only useful if the reader can act on it. Code identifies it, pointer locates it,
 * hint says what to do. Anything we know, we print.
 */
export const renderError = (color: boolean, error: LuminxError): string => {
  const lines = [`${paint(color, 'red', `✖ ${error.code}`)}  ${error.message}`];

  if (error.pointer !== undefined && error.pointer !== '') {
    lines.push(`    ${paint(color, 'dim', `at ${error.pointer}`)}`);
  }
  if (error.hint !== undefined) {
    lines.push(`    ${error.hint}`);
  }
  return `${lines.join('\n')}\n`;
};

export const renderErrors = (color: boolean, errors: readonly LuminxError[]): string =>
  errors.map((error) => renderError(color, error)).join('');

export const renderCheck = (color: boolean, check: HealthCheck): string => {
  const mark = paint(color, STATUS_STYLE[check.status], STATUS_MARK[check.status]);
  const lines = [`  ${mark} ${check.label.padEnd(28)} ${check.detail}`];

  if (check.fix !== undefined) {
    lines.push(`      ${paint(color, 'dim', check.fix)}`);
  }
  return `${lines.join('\n')}\n`;
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

export const renderChecks = (color: boolean, checks: readonly HealthCheck[]): string => {
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const check of checks) counts[check.status]++;

  const body = checks.map((check) => renderCheck(color, check)).join('');
  const summary = `\n  ${counts.pass} passed   ${plural(counts.warn, 'warning')}   ${counts.fail} failed\n`;

  return `${body}${summary}`;
};

/** Machine-readable output. Stable key order, so `--json` diffs cleanly between runs. */
export const renderJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
