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
 * The SSH runner reserved for `deploy` (§7.3, §11.2). A stub: its shape is settled — it is a
 * Runner like the others — but the implementation ships with `@luminx/deploy`, which is a
 * separate package under its own licence (§11.3). It reaches a remote host over the SSH trust the
 * developer or CI already has; there is no inbound endpoint, and that is a security property, not
 * a gap.
 *
 * Its `exec` refuses rather than pretends. Reserving the seam is the whole of M12 (§14): deploy is
 * architecture now, not code.
 */
export const createSshRunner = (options: RunnerOptions & { host?: string }): Runner => ({
  id: 'ssh',
  describe: (args) => `ssh ${options.host ?? '<host>'} 'cd … && php craft ${args.join(' ')}'`,
  exec: () =>
    Promise.reject(
      new Error('The SSH runner ships with `luminx deploy` (LuminX 1.x). See docs/deploy.md.'),
    ),
});

export const createRunner = (id: RunnerId, options: RunnerOptions): Runner => {
  switch (id) {
    case 'ddev':
      return createDdevRunner(options);
    case 'docker':
      return createDockerRunner(options);
    case 'ssh':
      return createSshRunner(options);
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
