/**
 * @luminx/core — config loading, compilation, diffing, planning, execution.
 *
 * This package must never mention a concrete CMS. Everything CMS-specific reaches it
 * through the CmsAdapter interface. `pnpm check:purity` enforces this.
 *
 * Contents land in M2 (config) and M5 (diff). See docs/architecture.md §3.2.
 */
export { PROTOCOL_VERSION } from '@luminx/shared';
