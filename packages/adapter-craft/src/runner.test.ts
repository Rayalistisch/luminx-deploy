import { describe, expect, it } from 'vitest';

import {
  createDdevRunner,
  createDockerRunner,
  createLocalRunner,
  createRunner,
  createSshRunner,
} from './runner.js';

const options = { cwd: '/project' };

describe('runners', () => {
  it('describe the command they will run', () => {
    expect(createLocalRunner(options).describe(['luminx/introspect'])).toBe(
      'php craft luminx/introspect',
    );
    expect(createDdevRunner(options).describe(['luminx/introspect'])).toBe(
      'ddev exec php craft luminx/introspect',
    );
    expect(createDockerRunner({ ...options, service: 'web' }).describe(['a'])).toBe(
      'docker compose exec -T web php craft a',
    );
  });

  it('defaults the compose service to php', () => {
    expect(createDockerRunner(options).describe(['a'])).toContain('exec -T php php craft');
  });

  it('carries its own id, which doctor reports', () => {
    expect(createRunner('ddev', options).id).toBe('ddev');
    expect(createRunner('local', options).id).toBe('local');
    expect(createRunner('docker', options).id).toBe('docker');
  });

  // Reserved for deploy (§11.2). Its shape is settled; its exec refuses rather than pretends.
  describe('the ssh stub', () => {
    it('describes an ssh command', () => {
      expect(createSshRunner({ ...options, host: 'prod' }).describe(['luminx/apply'])).toContain(
        'ssh prod',
      );
    });

    it('carries the reserved id', () => {
      expect(createRunner('ssh', options).id).toBe('ssh');
    });

    it('refuses to exec, pointing at deploy', async () => {
      await expect(createSshRunner(options).exec(['luminx/introspect'])).rejects.toThrow(
        /luminx deploy/,
      );
    });
  });

  // Lando is detected by the parsers but has no runner. Falling back to local PHP would run
  // against a database that only exists inside the container.
  it('refuses lando loudly rather than falling back to local', () => {
    expect(() => createRunner('lando', options)).toThrow(/not implemented/);
  });
});

/**
 * `exec` itself has no test here.
 *
 * A test of it would need PHP on the machine running the TypeScript suite, and asserting only
 * that the promise settles would be a test that cannot fail. The spawn path is exercised where
 * it means something: against a real Craft install, in the DDEV verification.
 */
