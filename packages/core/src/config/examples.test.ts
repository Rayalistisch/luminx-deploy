import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { compile } from './compiler.js';
import { parseConfig } from './loader.js';

/**
 * The example configs are documentation, and documentation that does not compile is worse than
 * none. This walks `examples/config-samples` and holds each one to the same bar a user's config
 * meets: it parses, it compiles, and a matrix it describes really becomes a matrix.
 */
const samplesDir = fileURLToPath(new URL('../../../../examples/config-samples/', import.meta.url));

const samples = await readdir(samplesDir);

describe('example configs', () => {
  it('ships some', () => {
    expect(samples.filter((name) => name.endsWith('.jsonc')).length).toBeGreaterThan(0);
  });

  it.each(samples.filter((name) => name.endsWith('.jsonc')))(
    '%s parses and compiles',
    async (name) => {
      const text = await readFile(samplesDir + name, 'utf8');

      const parsed = parseConfig(text, name);
      expect(parsed.ok, `${name} should parse: ${JSON.stringify(parsed)}`).toBe(true);
      if (!parsed.ok) return;

      const compiled = compile(parsed.value);
      expect(compiled.ok, `${name} should compile: ${JSON.stringify(compiled)}`).toBe(true);
      if (!compiled.ok) return;

      expect(compiled.value.model.resources.size).toBeGreaterThan(0);
    },
  );
});
