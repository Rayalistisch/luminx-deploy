/**
 * Operations, and the plan that holds them (docs/architecture.md §8.2).
 *
 * A `Plan` is a serialisable artefact, not a transient value. `luminx plan` writes it, a
 * human reviews it in a pull request, and `deploy` later applies exactly it. That is why the
 * plan carries the hashes it was computed against and why `deploy` needed no new shape (§11).
 */

import type { Resource } from './ir.js';

/**
 * Content models are cyclic: a field in one section points at another, which points back.
 * Topological sorting cannot break that, so every apply runs twice over the graph.
 *
 * Phase 1 creates structure with references left empty; afterwards every resource exists and
 * has a UID. Phase 2 wires the references, now that every UID is known (§8.3).
 */
export type Phase = 1 | 2;

/** A single changed property, as a JSON pointer into the resource's spec. */
export interface FieldChange {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

export type Operation =
  | { readonly kind: 'create'; readonly resource: Resource; readonly phase: Phase }
  | {
      readonly kind: 'update';
      readonly resource: Resource;
      readonly uid: string;
      readonly changes: readonly FieldChange[];
      readonly phase: Phase;
    }
  | { readonly kind: 'skip'; readonly resource: Resource; readonly reason: 'unchanged' }
  /**
   * Only ever produced under `--prune`. A deleted section is deleted content, and `undo`
   * restores the model, not the entries that lived in it (§10).
   */
  | { readonly kind: 'delete'; readonly resource: Resource; readonly uid: string };

export type OperationKind = Operation['kind'];

/**
 * A resource present in the CMS but absent from the config. Reported, never acted on:
 * leaving something out of the config must not delete it (§8.2).
 */
export interface OrphanedResource {
  readonly logicalId: string;
  readonly kind: Resource['kind'];
  readonly handle: string;
  readonly uid: string;
}

export interface Plan {
  readonly version: 1;
  /** Adapter id the plan was computed for. Applying it elsewhere is a category error. */
  readonly cms: string;
  /** Hash of the compiled config. Identifies *what* was planned. */
  readonly sourceHash: string;
  /** Hash of the CMS state planned against. Identifies *from where* (§11.2). */
  readonly baseHash: string;
  readonly operations: readonly Operation[];
  readonly orphaned: readonly OrphanedResource[];
}

export interface OperationResult {
  readonly logicalId: string;
  readonly uid: string;
  readonly status: 'created' | 'updated' | 'skipped' | 'deleted';
  readonly warnings: readonly string[];
}

export interface PlanSummary {
  readonly create: number;
  readonly update: number;
  readonly skip: number;
  readonly delete: number;
  readonly total: number;
}

export const summarize = (plan: Plan): PlanSummary => {
  const summary = { create: 0, update: 0, skip: 0, delete: 0 };
  for (const operation of plan.operations) summary[operation.kind]++;
  return { ...summary, total: plan.operations.length };
};

/**
 * True when applying the plan would change nothing. `sync --check` exits 1 when this is
 * false, which is how a pipeline notices that production and config have drifted apart.
 */
export const isNoop = (plan: Plan): boolean =>
  plan.operations.every((operation) => operation.kind === 'skip');
