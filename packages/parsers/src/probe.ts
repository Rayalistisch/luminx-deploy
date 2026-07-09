/**
 * Reads a project and reports what it found (§3.3).
 *
 * The only place in this package that touches a filesystem. Everything it calls is a pure
 * function over text, which is why the parsers are testable without fixtures on disk and this
 * file needs only a handful of tests of its own.
 */

import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseComposerJson, parseComposerLock } from './composer.js';
import { parseDotEnvKeys } from './dotenv.js';
import type { ComposerFacts, LockState, ProjectFacts } from './facts.js';
import { detectFrameworks, parsePackageJson } from './frontend.js';
import { RUNNER_MARKERS, detectRunners, preferredRunner } from './runner.js';

/** Absent and unreadable are the same answer here: we cannot read it, so we know nothing. */
const readOrNull = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const composerFacts = async (root: string): Promise<ComposerFacts | null> => {
  const jsonText = await readOrNull(join(root, 'composer.json'));
  if (jsonText === null) return null;

  const json = parseComposerJson(jsonText);
  if (json === null) return null;

  const lockText = await readOrNull(join(root, 'composer.lock'));
  const lock = lockText === null ? null : parseComposerLock(lockText);

  const state: LockState = lockText === null ? 'absent' : lock === null ? 'unreadable' : 'parsed';

  return {
    name: json.name,
    phpConstraint: json.php,
    require: json.require,
    installed: lock?.installed ?? {},
    lock: state,
  };
};

export const probeProject = async (root: string): Promise<ProjectFacts> => {
  const markers = RUNNER_MARKERS.flatMap(([, paths]) => paths);
  const present = await Promise.all(
    markers.map(async (path) => [path, await exists(join(root, path))] as const),
  );
  const existing = new Set(present.filter(([, found]) => found).map(([path]) => path));

  const [composer, packageJsonText, envText] = await Promise.all([
    composerFacts(root),
    readOrNull(join(root, 'package.json')),
    readOrNull(join(root, '.env')),
  ]);

  const pkg = packageJsonText === null ? null : parsePackageJson(packageJsonText);
  const detectedRunners = detectRunners(existing);

  return {
    root,
    composer,
    frameworks: pkg === null ? [] : detectFrameworks(pkg),
    detectedRunners,
    runner: preferredRunner(detectedRunners),
    envKeys: envText === null ? null : parseDotEnvKeys(envText),
  };
};
