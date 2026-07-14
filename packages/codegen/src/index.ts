/**
 * @luminx/codegen — the content model, projected into TypeScript.
 *
 * Depends only on `@luminx/shared`: it reads the IR, so it knows no CMS, and it reads the config
 * rather than a live one. See docs/architecture.md §4 for why that matters.
 */

export { emitTypes } from './types.js';
