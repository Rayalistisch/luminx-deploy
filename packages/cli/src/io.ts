/**
 * Everything the CLI does to the outside world, behind one interface.
 *
 * Commands take an `Io` rather than reaching for `console` and `process`, which is the only
 * reason a command can be tested by calling it.
 */

import { createInterface } from 'node:readline/promises';

export interface Io {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Asks a question. Returns `fallback` when the answer is empty. */
  readonly ask: (question: string, fallback: string) => Promise<string>;
  readonly confirm: (question: string) => Promise<boolean>;
  /** False when output is piped, redirected, or the user asked for no colour. */
  readonly color: boolean;
  /** True when nothing may prompt: CI, `--yes`, or a non-interactive stdin. */
  readonly assumeYes: boolean;
}

export interface IoOptions {
  readonly color?: boolean;
  readonly assumeYes?: boolean;
}

/**
 * Honours NO_COLOR (https://no-color.org) and whether stdout is a terminal. A tool that writes
 * escape codes into a pipe has corrupted the file the user was building.
 */
const colorSupported = (): boolean =>
  process.env['NO_COLOR'] === undefined && process.stdout.isTTY === true;

export const createIo = (options: IoOptions = {}): Io => {
  const assumeYes = options.assumeYes ?? false;

  const prompt = async (question: string): Promise<string> => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return (await rl.question(question)).trim();
    } finally {
      rl.close();
    }
  };

  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    color: options.color ?? colorSupported(),
    assumeYes,
    ask: async (question, fallback) => {
      if (assumeYes) return fallback;
      const answer = await prompt(`${question} (${fallback}) `);
      return answer === '' ? fallback : answer;
    },
    // Defaults to no. An unattended run must never destroy something by silence.
    confirm: async (question) => {
      if (assumeYes) return true;
      const answer = await prompt(`${question} (y/N) `);
      return /^y(es)?$/i.test(answer);
    },
  };
};
