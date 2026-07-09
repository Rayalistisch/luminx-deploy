/**
 * @luminx/core — config loading, compilation, diffing, planning, execution.
 *
 * This package must never mention a concrete CMS. Everything CMS-specific reaches it
 * through the CmsAdapter interface. `pnpm check:purity` enforces this.
 *
 * Diffing, planning and execution land in M5. See docs/architecture.md §3.2.
 */

export { hashOf } from './hash.js';
export { compile } from './config/compiler.js';
export type { CompiledModel } from './config/compiler.js';
export { loadConfig, parseConfig, validateConfig } from './config/loader.js';
export { pointerOf } from './config/pointer.js';
export { ConfigSchema } from './config/schema.js';
export * from './config/types.js';
