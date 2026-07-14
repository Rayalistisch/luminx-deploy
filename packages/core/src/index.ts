/**
 * @luminx/core — config loading, compilation, diffing, planning, execution.
 *
 * This package must never mention a concrete CMS. Everything CMS-specific reaches it
 * through the CmsAdapter interface. `pnpm check:purity` enforces this.
 *
 * See docs/architecture.md §3.2.
 */

export { hashOf } from './hash.js';

export { checkCapabilities } from './adapter/capabilities.js';
export type {
  AdapterContext,
  ApplyContext,
  Capabilities,
  CmsAdapter,
  CmsInfo,
  ContentBlock,
  ContentEntry,
  ContentReport,
  ScaffoldContext,
  ScaffoldOptions,
  ScaffoldResult,
} from './adapter/contract.js';
export { MEMORY_ADAPTER_ID, createMemoryAdapter, currentModelOf } from './adapter/memory.js';
export { createRegistry } from './adapter/registry.js';
export type { AdapterRegistry } from './adapter/registry.js';

export { compile } from './config/compiler.js';
export type { CompiledModel } from './config/compiler.js';
export { decompile } from './config/decompiler.js';
export { loadConfig, parseConfig, validateConfig } from './config/loader.js';
export { pointerOf } from './config/pointer.js';
export { ConfigSchema } from './config/schema.js';
export * from './config/types.js';

export { diffValues } from './diff/changes.js';
export { diff } from './diff/differ.js';
export type { DiffInput } from './diff/differ.js';
export { detectDrift } from './diff/drift.js';
export type { Drift } from './diff/drift.js';

export { execute } from './plan/executor.js';
export type { ExecuteInput, ExecutionReport } from './plan/executor.js';
export { topologicalOrder } from './plan/orderer.js';
export { hasWiring, isWiringPath, wiringPathsOf } from './plan/phases.js';

export { emptyLockfile, lookup, readLockfile, writeLockfile } from './state/lockfile.js';
export type { LockEntry, Lockfile } from './state/lockfile.js';
