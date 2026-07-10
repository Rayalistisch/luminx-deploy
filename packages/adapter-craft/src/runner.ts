/**
 * How PHP gets called (docs/architecture.md §7.3).
 *
 * The hardest practical problem in the project: the CLI runs in Node, Craft runs in PHP, and
 * that PHP usually lives in a container. Every way of reaching it is one implementation of one
 * interface, chosen by `RunnerDetector` and always overridable with `--runner`.
 *
 * This is one of the few places with environment-dependent behaviour, so it is explicit, it is
 * logged, and `luminx doctor` reports which one was chosen.
 */

import { spawn } from 'node:child_process';

import type { RunnerId } from '@luminx/shared';

export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Runner {
  readonly id: RunnerId;
  /** The command it will run, for `--verbose` and for doctor. Never executed from this string. */
  readonly describe: (craftArgs: readonly string[]) => string;
  /** Runs `craft <args>` however this runner reaches PHP. */
  readonly exec: (craftArgs: readonly string[]) => Promise<ExecResult>;
}

export interface RunnerOptions {
  readonly cwd: string;
  /** Docker Compose only: which service holds PHP. */
  readonly service?: string;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Arguments are passed as an array, never interpolated into a shell string. A uriFormat like
 * `{parent.uri}/{slug}` is ordinary content here, not something a shell gets to expand.
 */
const run = (
  command: string,
  args: readonly string[],
  options: RunnerOptions,
): Promise<ExecResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: options.cwd, shell: false });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));

    child.on('error', (error) => {
      clearTimeout(timer);
      if (!settled) reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (!settled) resolve({ code: code ?? 1, stdout, stderr });
    });
  });

export const createLocalRunner = (options: RunnerOptions): Runner => ({
  id: 'local',
  describe: (args) => `php craft ${args.join(' ')}`,
  exec: (args) => run('php', ['craft', ...args], options),
});

export const createDdevRunner = (options: RunnerOptions): Runner => ({
  id: 'ddev',
  describe: (args) => `ddev exec php craft ${args.join(' ')}`,
  exec: (args) => run('ddev', ['exec', 'php', 'craft', ...args], options),
});

export const createDockerRunner = (options: RunnerOptions): Runner => {
  const service = options.service ?? 'php';

  return {
    id: 'docker',
    describe: (args) => `docker compose exec -T ${service} php craft ${args.join(' ')}`,
    exec: (args) =>
      run('docker', ['compose', 'exec', '-T', service, 'php', 'craft', ...args], options),
  };
};

/**
 * The SSH runner from §7.3 is not here. It would need a fifth `RunnerId`, and inventing one now
 * — or worse, giving it `local`'s id — would put a lie in a type to reserve a name. `deploy`
 * brings its own runner when it brings its own environments (§11.2); this interface is the only
 * thing it needs, and that is settled.
 */
export const createRunner = (id: RunnerId, options: RunnerOptions): Runner => {
  switch (id) {
    case 'ddev':
      return createDdevRunner(options);
    case 'docker':
      return createDockerRunner(options);
    case 'lando':
      // Lando is detected (§3.3) but has no runner yet. Failing loudly beats running the
      // developer's host PHP against a database that only exists inside the container.
      throw new Error(
        'The Lando runner is not implemented. Use --runner=local or --runner=docker.',
      );
    case 'local':
      return createLocalRunner(options);
  }
};
