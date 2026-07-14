import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { ProjectFacts } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { capabilitiesFor } from './adapter.js';

/**
 * The adapter claims what Craft can express (TypeScript). The plugin decides what it can actually
 * write (PHP). They are two lists, in two languages, in two artefacts on two release cycles — and
 * nothing stopped them drifting apart.
 *
 * They did. The adapter claimed `navigation` whenever verbb/navigation was installed, and no
 * NavigationGenerator ever existed. A config using it would validate, plan, snapshot, and then die
 * mid-apply on "no generator for this resource kind" — the precise failure capabilities exist to
 * prevent (§7.1). No test caught it, because no test installs the provider.
 *
 * This one reads the plugin's source and holds the two lists to each other. A capability the
 * plugin cannot deliver now fails here, on every push, instead of on someone's database.
 */

const pluginRoot = fileURLToPath(new URL('../../craft-plugin/', import.meta.url));

const facts = (installed: Record<string, string> = {}): ProjectFacts => ({
  root: '/project',
  composer: { name: 'acme/site', phpConstraint: '^8.3', require: {}, installed, lock: 'parsed' },
  frameworks: [],
  detectedRunners: [],
  runner: 'local',
  envKeys: null,
});

/** The ResourceKind each generator in the plugin declares it handles, read from its `kind()`. */
const generatorKinds = async (): Promise<string[]> => {
  const dir = `${pluginRoot}src/Apply/Generators/`;
  const files = (await readdir(dir)).filter((name) => name.endsWith('.php'));

  const kinds = await Promise.all(
    files.map(async (name) => {
      const source = await readFile(dir + name, 'utf8');
      // `public function kind(): string { return 'section'; }`
      const match = /function kind\(\)[^{]*\{\s*return '([^']+)'/.exec(source);
      if (match?.[1] === undefined) throw new Error(`${name} declares no kind()`);
      return match[1];
    }),
  );

  return kinds.sort();
};

/** The generators the plugin's registry actually constructs — a class listed nowhere is dead. */
const registeredGenerators = async (): Promise<string[]> => {
  const source = await readFile(`${pluginRoot}src/Apply/GeneratorRegistry.php`, 'utf8');
  return [...source.matchAll(/new (\w+Generator)\(\)/g)].map((match) => match[1] as string).sort();
};

describe('the adapter and the plugin agree on what Craft can do', () => {
  it('claims exactly the resource kinds the plugin has generators for', async () => {
    const claimed = [...capabilitiesFor(facts()).resourceKinds].sort();
    expect(claimed).toEqual(await generatorKinds());
  });

  // The provider's absence is the point: installing it must not conjure a capability out of thin
  // air while the generator is still missing.
  it('claims no more when a provider plugin is installed but has no generator', async () => {
    const withProvider = capabilitiesFor(facts({ 'verbb/navigation': '4.0.0-beta.3' }));

    expect([...withProvider.resourceKinds].sort()).toEqual(await generatorKinds());
    expect(withProvider.resourceKinds).not.toContain('navigation');
  });

  it('registers every generator it ships, so none is dead code', async () => {
    const files = (await readdir(`${pluginRoot}src/Apply/Generators/`))
      .filter((name) => name.endsWith('.php'))
      .map((name) => name.replace('.php', ''))
      .sort();

    expect(await registeredGenerators()).toEqual(files);
  });
});
