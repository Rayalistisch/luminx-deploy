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
  it('knows a relation field wires its sources', () => {
    expect(
      wiringPathsOf(resource({ kind: 'field', spec: { type: 'entries', sources: [] } })),
    ).toEqual(['/spec/sources']);

    expect(
      wiringPathsOf(resource({ kind: 'field', spec: { type: 'assets', sources: [] } })),
    ).toEqual(['/spec/sources']);
  });

  // §8.3 puts these in phase 2, and a CMS may refuse: neither a section without entry types nor a
  // matrix without them need be a valid thing to save, even for a moment. Both edges are acyclic,
  // so ordering inside phase 1 handles them — they are dependencies, not wiring.
  it('says a matrix does not wire its entry types, since one cannot be created without them', () => {
    expect(
      wiringPathsOf(resource({ kind: 'field', spec: { type: 'matrix', entryTypes: [] } })),
    ).toEqual([]);
  });

  it('says a section does not wire its entry types, for the same reason', () => {
    expect(
      wiringPathsOf(resource({ kind: 'section', spec: { type: 'channel', entryTypes: [] } })),
    ).toEqual([]);
  });

  // A field layout names fields that already exist, and nothing points back at the entry type.
  it('says an entry type does not wire its field layout', () => {
    expect(wiringPathsOf(resource({ kind: 'entryType', spec: { fields: [] } }))).toEqual([]);
  });

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
  it('is true when a relation field has sources', () => {
    expect(
      hasWiring(resource({ kind: 'field', spec: { type: 'entries', sources: ['section:blog'] } })),
    ).toBe(true);
  });

  // Otherwise a second `generate` would report a phase-2 operation with nothing in it.
  it('is false when the wiring is empty', () => {
    expect(hasWiring(resource({ kind: 'field', spec: { type: 'entries', sources: [] } }))).toBe(
      false,
    );
  });

  it('is false for everything ordering can place', () => {
    expect(hasWiring(resource({ kind: 'entryType', spec: { fields: [] } }))).toBe(false);
    expect(
      hasWiring(resource({ kind: 'field', spec: { type: 'matrix', entryTypes: ['entryType:a'] } })),
    ).toBe(false);
  });
});

describe('isWiringPath', () => {
  const relation = resource({ kind: 'field', spec: { type: 'entries', sources: [] } });

  it('matches the wiring path and anything under it', () => {
    expect(isWiringPath(relation, '/spec/sources')).toBe(true);
    expect(isWiringPath(relation, '/spec/sources/0')).toBe(true);
  });

  it('does not match structure', () => {
    expect(isWiringPath(relation, '/name')).toBe(false);
    expect(isWiringPath(relation, '/spec/maxRelations')).toBe(false);
  });
});
