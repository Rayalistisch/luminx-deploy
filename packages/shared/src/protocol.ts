/**
 * The wire format between the CLI and whatever runs inside the CMS (docs/architecture.md §7.4).
 *
 * Requests and responses travel as files, not over stdout: the CMS, its framework and any
 * installed plugin will happily print deprecation notices and debugger warnings into a stream
 * we would otherwise have to parse around.
 *
 * The exit code reports transport failure. Domain failure lives in `errors` on a response
 * that arrived intact. Confusing the two is how a tool ends up retrying a validation error.
 */

import type { LuminxError } from './errors.js';
import type { ContentModel, Resource, ResourceKind } from './ir.js';
import type { Operation, OperationResult, Phase } from './plan.js';

/** Bumped whenever the CLI↔CMS wire format changes incompatibly. */
export const PROTOCOL_VERSION = 1 as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;

/**
 * Free-form facts about the far side: versions of the runtime, the CMS, the plugin. A map
 * rather than named fields, because naming them here would teach this package which CMS it
 * is talking to — and it must not know.
 */
export type Diagnostics = Readonly<Record<string, string>>;

interface EnvelopeBase {
  readonly protocolVersion: number;
  readonly warnings: readonly string[];
  readonly diagnostics: Diagnostics;
}

export interface OkEnvelope<T> extends EnvelopeBase {
  readonly ok: true;
  readonly data: T;
  readonly errors: readonly [];
}

export interface ErrEnvelope extends EnvelopeBase {
  readonly ok: false;
  readonly errors: readonly [LuminxError, ...LuminxError[]];
}

/**
 * A response either carries data or carries at least one error. The union makes the
 * `ok: true, errors: [...]` state unrepresentable rather than merely discouraged.
 */
export type Envelope<T> = OkEnvelope<T> | ErrEnvelope;

export interface IntrospectRequest {
  readonly protocolVersion: ProtocolVersion;
  /** Narrows the read, as `--only sections,fields` does. Absent means everything. */
  readonly kinds?: readonly ResourceKind[];
}

export type IntrospectResponse = Envelope<ContentModel>;

export interface ApplyRequest {
  readonly protocolVersion: ProtocolVersion;
  readonly phase: Phase;
  readonly operations: readonly Operation[];
  /**
   * UIDs resolved so far, keyed by logicalId. Phase 2 wires references with these; it is
   * how a generator learns another resource's UID without ever calling that generator (§9.2).
   */
  readonly resolved: Readonly<Record<string, string>>;
}

export type ApplyResponse = Envelope<{ readonly results: readonly OperationResult[] }>;

export interface SnapshotRef {
  readonly id: string;
  readonly createdAt: string;
  readonly planHash: string;
}

export type SnapshotResponse = Envelope<SnapshotRef>;

export const HEALTH_STATUSES = ['pass', 'warn', 'fail'] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export interface HealthCheck {
  readonly id: string;
  readonly label: string;
  readonly status: HealthStatus;
  readonly detail: string;
  /** What the user should run or change. Absent when a passing check needs no advice. */
  readonly fix?: string;
}

export type DoctorResponse = Envelope<{ readonly checks: readonly HealthCheck[] }>;

/**
 * The adapter refuses to run against a plugin speaking a different version. There is no
 * implicit compatibility: a wire format that silently half-works is worse than one that stops.
 */
export const isCompatible = (theirs: number): boolean => theirs === PROTOCOL_VERSION;

/** Narrowing helper so callers do not reach for `.data` on a failed envelope. */
export const isOkEnvelope = <T>(envelope: Envelope<T>): envelope is OkEnvelope<T> => envelope.ok;

/** A resource as the CMS reports it: the IR shape, plus the UID the CMS assigned. */
export interface IntrospectedResource {
  readonly resource: Resource;
  readonly uid: string;
}
