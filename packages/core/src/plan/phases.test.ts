import type { Resource } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { hasWiring, isWiringPath, wiringPathsOf } from './phases.js';

const resource = (partial: Partial<Resource> & Pick<Resource, 'kind' | 'spec'>): Resource =>
  ({
    logicalId: 'x:y',
    handle: 'y',
    name: 'Y',
    dependsOn: [],
    hash: 'sha256:x',
    ...partial,
  }) as Resource;

describe('wiringPathsOf', () => {
  it('knows a matrix wires its entry types', () => {
    expect(
      wiringPathsOf(resource({ kind: 'field', spec: { type: 'matrix', entryTypes: [] } })),
    ).toEqual(['/spec/entryTypes']);
  });

  it('knows a relation field wires its sources', () => {
    expect(
      wiringPathsOf(resource({ kind: 'field', spec: { type: 'entries', sources: [] } })),
    ).toEqual(['/spec/sources']);
  });

  it('knows an entry type wires its field layout', () => {
    expect(wiringPathsOf(resource({ kind: 'entryType', spec: { fields: [] } }))).toEqual([
      '/spec/fields',
    ]);
  });

  // A volume needs its filesystem's UID, but ordering inside phase 1 supplies it. Wiring is
  // what ordering cannot solve.
  it('says a volume has no wiring, because dependsOn is not wiring', () => {
    expect(wiringPathsOf(resource({ kind: 'volume', spec: { fs: 'filesystem:local' } }))).toEqual(
      [],
    );
  });

  it('says a plain field has no wiring', () => {
    expect(wiringPathsOf(resource({ kind: 'field', spec: { type: 'text' } }))).toEqual([]);
  });
});

describe('hasWiring', () => {
  it('is true when there is something to wire', () => {
    expect(
      hasWiring(
        resource({ kind: 'entryType', spec: { fields: [{ field: 'field:a', required: false }] } }),
      ),
    ).toBe(true);
  });

  // Otherwise a second `generate` would report a phase-2 operation with nothing in it.
  it('is false when the wiring is empty', () => {
    expect(hasWiring(resource({ kind: 'entryType', spec: { fields: [] } }))).toBe(false);
    expect(hasWiring(resource({ kind: 'field', spec: { type: 'matrix', entryTypes: [] } }))).toBe(
      false,
    );
  });
});

describe('isWiringPath', () => {
  const entryType = resource({ kind: 'entryType', spec: { fields: [] } });

  it('matches the wiring path and anything under it', () => {
    expect(isWiringPath(entryType, '/spec/fields')).toBe(true);
    expect(isWiringPath(entryType, '/spec/fields/0/required')).toBe(true);
  });

  it('does not match structure', () => {
    expect(isWiringPath(entryType, '/name')).toBe(false);
    expect(isWiringPath(entryType, '/spec/fieldsExtra')).toBe(false);
  });
});
