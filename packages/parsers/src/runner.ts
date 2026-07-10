/**
 * How PHP can be reached: bare on PATH, or inside a container (§7.3).
 *
 * Detection and preference are kept apart on purpose. Which marker files exist is a fact.
 * Which runner to use when several exist is a policy, and one the user overrides with
 * `--runner`. Mixing them would hide the choice inside the observation.
 */

import { RUNNERS } from '@luminx/shared';
import type { RunnerId } from '@luminx/shared';

/**
 * Marker files, in the order a runner takes precedence. A project with both `.ddev/config.yaml`
 * and a `docker-compose.yml` is almost always a DDEV project that also ships a compose file.
 */
export const RUNNER_MARKERS: readonly (readonly [RunnerId, readonly string[]])[] = [
  ['ddev', ['.ddev/config.yaml', '.ddev/config.yml']],
  ['lando', ['.lando.yml', '.lando.yaml']],
  ['docker', ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']],
];

/** Every runner whose marker is present, most-specific first. `local` is never *detected*. */
export const detectRunners = (existingPaths: ReadonlySet<string>): readonly RunnerId[] =>
  RUNNER_MARKERS.flatMap(([id, markers]) =>
    markers.some((marker) => existingPaths.has(marker)) ? [id] : [],
  );

/**
 * The policy: the most specific detected runner, or `local` when nothing containerised is found.
 *
 * `local` as a fallback rather than a detection: PHP on PATH says nothing about whether *this*
 * project's PHP is the one on PATH. `doctor` checks that separately, and reports what it chose.
 */
export const preferredRunner = (detected: readonly RunnerId[]): RunnerId => detected[0] ?? 'local';

export const isRunnerId = (value: string): value is RunnerId =>
  (RUNNERS as readonly string[]).includes(value);
