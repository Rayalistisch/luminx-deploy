/**
 * @luminx/adapter-craft — the only TypeScript package allowed to know about Craft CMS.
 *
 * Holds the Runner abstraction (local / DDEV / Docker / SSH), the protocol client, and the
 * translation between the IR and Craft's vocabulary. It executes operations the core
 * decided on; it never decides on one itself.
 *
 * Contents land in M7. See docs/architecture.md §7.
 */
export const ADAPTER_ID = 'craft' as const;
