import type { CurrentModel } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { currentModelOf } from '../adapter/memory.js';
import { compile } from '../config/compiler.js';
import type { CompiledModel } from '../config/compiler.js';
import { validateConfig } from '../config/loader.js';
import type { Lockfile } from '../state/lockfile.js';
import { detectDrift } from './drift.js';

const compiled = (raw: unknown): CompiledModel => {
  const parsed = validateConfig(raw);
  if (!parsed.ok) throw new Error(`schema rejected: ${JSON.stringify(parsed.error)}`);
  const result = compile(parsed.value);
  if (!result.ok) throw new Error(`compile failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

const model = (text: string) =>
  compiled({
    version: 1,
    cms: 'memory',
    sections: [
      {
        handle: 'pages',
        type: 'channel',
        entryTypes: [
          { handle: 'page', fields: [{ handle: 'title2', type: 'text', max: text.length }] },
        ],
      },
    ],
  });

/** A lockfile whose hashes match a given compiled model — i.e. that model was the last apply. */
const lockfileFor = (m: CompiledModel): Lockfile => ({
  version: 1,
  cms: 'memory',
  generatedAt: '1970-01-01T00:00:00.000Z',
  resources: Object.fromEntries(
    [...m.model.resources].map(([id, resource]) => [id, { uid: `uid-${id}`, hash: resource.hash }]),
  ),
});

const currentFrom = (m: CompiledModel): CurrentModel =>
  currentModelOf([...m.model.resources.values()]);

describe('detectDrift', () => {
  it('finds nothing without a lockfile: a first run cannot have drifted', () => {
    const m = model('a');
    expect(detectDrift(m, currentFrom(m), null)).toEqual([]);
  });

  it('finds nothing when config, lockfile and CMS all agree', () => {
    const m = model('a');
    expect(detectDrift(m, currentFrom(m), lockfileFor(m))).toEqual([]);
  });

  // The case §5.3 is about: config unchanged since the last apply, CMS changed underneath.
  it('reports a resource the CMS changed while the config did not', () => {
    const applied = model('a'); // what was last applied; the lockfile matches this
    const cmsNow = model('changed-in-the-cp'); // the field's max differs in the CMS

    const drift = detectDrift(applied, currentFrom(cmsNow), lockfileFor(applied));

    expect(drift.map((d) => d.logicalId)).toEqual(['field:title2']);
    expect(drift[0]?.kind).toBe('field');
  });

  // A field the developer changed in the config is an ordinary update, not drift — the differ
  // already reports it, and calling it drift would blame the CP for the developer's own edit.
  it('does not call an intended config change drift', () => {
    const applied = model('a');
    const configNow = model('b'); // the config moved on; lockfile still reflects `applied`
    const cmsNow = model('a'); // the CMS still holds what was applied

    expect(detectDrift(configNow, currentFrom(cmsNow), lockfileFor(applied))).toEqual([]);
  });

  it('ignores a resource missing from the CMS, which the plan reports as a create', () => {
    const applied = model('a');
    const emptyCms: CurrentModel = { resources: new Map() };

    expect(detectDrift(applied, emptyCms, lockfileFor(applied))).toEqual([]);
  });
});
