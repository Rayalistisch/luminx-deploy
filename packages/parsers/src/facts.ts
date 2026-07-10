/**
 * `ProjectFacts` now lives in `@luminx/shared`, because the adapter contract in `core` takes it
 * and `core` may depend only on `shared` (§4, §7.1). This file re-exports it so callers of this
 * package need not know where the type ended up.
 *
 * The types stay CMS-neutral. See the note in shared's project.ts.
 */

export type {
  ComposerFacts,
  Framework,
  FrameworkId,
  LockState,
  ProjectFacts,
  RunnerId,
} from '@luminx/shared';
