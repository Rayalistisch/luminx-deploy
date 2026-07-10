/**
 * Turning values into the text a person reads. No logic lives here beyond presentation.
 */

import { summarize } from '@luminx/shared';
import type { HealthCheck, HealthStatus, LuminxError, OperationKind, Plan } from '@luminx/shared';

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

const OPERATION_STYLE: Readonly<Record<OperationKind, Style>> = {
  create: 'green',
  update: 'yellow',
  delete: 'red',
  skip: 'dim',
};

interface PlanLine {
  readonly kind: OperationKind;
  readonly resourceKind: string;
  readonly handle: string;
  readonly changed: string[];
}

/**
 * One line per resource, not per operation.
 *
 * A resource with references produces two operations — structure, then wiring (§8.3) — and
 * seeing `create section pages` twice tells the reader something about LuminX's execution
 * order rather than about their content model. The phases are real and `--json` keeps them;
 * the preview answers "what will change".
 */
const collapse = (plan: Plan): readonly PlanLine[] => {
  const lines = new Map<string, PlanLine>();

  for (const operation of plan.operations) {
    const key = `${operation.kind}:${operation.resource.logicalId}`;
    const existing = lines.get(key);
    const changed =
      operation.kind === 'update'
        ? operation.changes.map((change) => change.path.split('/').pop() ?? '')
        : [];

    if (existing === undefined) {
      lines.set(key, {
        kind: operation.kind,
        resourceKind: operation.resource.kind,
        handle: operation.resource.handle,
        changed,
      });
    } else {
      existing.changed.push(...changed);
    }
  }

  return [...lines.values()];
};

const detailOf = (line: PlanLine): string => {
  if (line.kind === 'skip') return 'unchanged';
  if (line.changed.length === 0) return '';
  return line.changed.length > 3
    ? `${line.changed.slice(0, 3).join(', ')}, +${line.changed.length - 3}`
    : line.changed.join(', ');
};

export const renderPlan = (color: boolean, plan: Plan): string => {
  const collapsed = collapse(plan);

  const lines = collapsed.map((line) => {
    const kind = paint(color, OPERATION_STYLE[line.kind], line.kind.padEnd(7));
    return `  ${kind}  ${line.resourceKind.padEnd(11)} ${line.handle.padEnd(20)} ${detailOf(line)}`;
  });

  const counts = { create: 0, update: 0, skip: 0, delete: 0 };
  for (const line of collapsed) counts[line.kind]++;

  const operations = summarize(plan).total;

  // Most models need no second phase at all: only a relation field's sources are wired late.
  // Saying "across two phases" when there is one would describe work that is not there.
  const phased = plan.operations.some((operation) => 'phase' in operation && operation.phase === 2);
  const detail = `${operations} operations${phased ? ' across two phases' : ''}`;

  const summary =
    `\n  ${collapsed.length} resources   ${counts.create} create   ${counts.update} update   ` +
    `${counts.skip} skip   ${counts.delete} delete\n` +
    `  ${paint(color, 'dim', detail)}\n`;

  // Orphans are reported, never acted on. Saying nothing would let a section quietly rot.
  const orphans =
    plan.orphaned.length === 0
      ? ''
      : `\n  ${paint(color, 'yellow', 'Orphaned')} — in the CMS, absent from the config. Not touched.\n` +
        plan.orphaned.map((entry) => `    ${entry.kind.padEnd(11)} ${entry.handle}\n`).join('') +
        `  Remove them with ${paint(color, 'bold', 'luminx sync --prune')}.\n`;

  return `${lines.join('\n')}\n${summary}${orphans}`;
};
