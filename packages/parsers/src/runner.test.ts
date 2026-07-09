import { describe, expect, it } from 'vitest';

import { detectRunners, isRunnerId, preferredRunner } from './runner.js';

const paths = (...entries: string[]) => new Set(entries);

describe('detectRunners', () => {
  it('finds nothing in a bare project', () => {
    expect(detectRunners(paths())).toEqual([]);
  });

  it('accepts either spelling of a marker', () => {
    expect(detectRunners(paths('.ddev/config.yaml'))).toEqual(['ddev']);
    expect(detectRunners(paths('.ddev/config.yml'))).toEqual(['ddev']);
    expect(detectRunners(paths('compose.yaml'))).toEqual(['docker']);
  });

  it('reports every runner it finds, most specific first', () => {
    expect(detectRunners(paths('docker-compose.yml', '.ddev/config.yaml'))).toEqual([
      'ddev',
      'docker',
    ]);
  });

  it('never detects local, which is a fallback rather than an observation', () => {
    expect(detectRunners(paths('.lando.yml'))).not.toContain('local');
  });
});

describe('preferredRunner', () => {
  // A DDEV project usually also ships a compose file. Detection sees both; policy picks one.
  it('takes the most specific detected runner', () => {
    expect(preferredRunner(['ddev', 'docker'])).toBe('ddev');
  });

  it('falls back to local when nothing containerised was found', () => {
    expect(preferredRunner([])).toBe('local');
  });
});

describe('isRunnerId', () => {
  it('accepts the four known runners and nothing else', () => {
    expect(isRunnerId('ddev')).toBe(true);
    expect(isRunnerId('local')).toBe(true);
    expect(isRunnerId('kubernetes')).toBe(false);
  });
});
