/**
 * @luminx/shared — the contract every other package speaks.
 *
 * Contents land in M1: intermediate representation, operations, plan, wire protocol,
 * error codes. See docs/architecture.md §3.1 and §6.
 */

/** Bumped whenever the CLI↔CMS wire format changes incompatibly. */
export const PROTOCOL_VERSION = 1 as const;
