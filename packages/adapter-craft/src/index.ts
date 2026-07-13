/**
 * @luminx/adapter-craft — the only TypeScript package allowed to know about Craft CMS.
 *
 * Holds the Runner abstraction, the protocol client, and the translation between the IR and
 * Craft's vocabulary. It executes operations the core decided on; it never decides on one itself.
 *
 * See docs/architecture.md §7.
 */

export { CRAFT_ADAPTER_ID, capabilitiesFor, createCraftAdapter } from './adapter.js';
export type { CraftAdapterOptions } from './adapter.js';
export { EXCHANGE_DIR, createProtocolClient } from './protocol.js';
export type { CallResult, ProtocolClient, ProtocolClientOptions } from './protocol.js';
export {
  createDdevRunner,
  createDockerRunner,
  createLocalRunner,
  createRunner,
  createSshRunner,
} from './runner.js';
export type { ExecResult, Runner, RunnerOptions } from './runner.js';
export { toCurrentModel } from './translate.js';
