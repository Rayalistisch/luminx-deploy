/**
 * @luminx/shared — the contract every other package speaks.
 *
 * Zero dependencies, no I/O, no logging. It describes what a content model is, what may be
 * done to one, and how the CLI and the CMS talk about it. See docs/architecture.md §3.1.
 */

export * from './canonical.js';
export * from './errors.js';
export * from './ir.js';
export * from './plan.js';
export * from './project.js';
export * from './protocol.js';
export * from './result.js';
