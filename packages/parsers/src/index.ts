/**
 * @luminx/parsers — file readers that answer questions about a project.
 *
 * A parser returns a parsed fact or null. It never guesses. Unlike core, this package is
 * allowed to name concrete CMSes: identifying them is its job. `ProjectFacts` itself stays
 * neutral — see the note in facts.ts.
 *
 * `ProjectConfigYamlParser` from §3.3 is not here. Reading `config/project/*.yaml` for offline
 * introspection is CMS-shaped work that belongs beside the adapter, and it lands with M6.
 *
 * See docs/architecture.md §3.3.
 */

export { normalizeVersion, parseComposerJson, parseComposerLock } from './composer.js';
export type { ComposerJson, ComposerLock } from './composer.js';
export { parseDotEnvKeys } from './dotenv.js';
export type { ComposerFacts, LockState, ProjectFacts } from './facts.js';
export { FRAMEWORKS, detectFrameworks, parsePackageJson } from './frontend.js';
export type { Framework, FrameworkId, PackageJson } from './frontend.js';
export { parseJsonObject, stringRecord } from './json.js';
export { probeProject } from './probe.js';
export { RUNNERS, RUNNER_MARKERS, detectRunners, isRunnerId, preferredRunner } from './runner.js';
export type { RunnerId } from './runner.js';
