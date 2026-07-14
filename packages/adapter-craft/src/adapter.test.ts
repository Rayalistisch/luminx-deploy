import { tmpdir } from 'node:os';

import { hashOf } from '@luminx/core';
import type { ProjectFacts } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { capabilitiesFor, createCraftAdapter } from './adapter.js';
import type { Runner } from './runner.js';
import { toCurrentModel } from './translate.js';

const facts = (installed: Record<string, string> = {}): ProjectFacts => ({
  root: tmpdir(),
  composer: {
    name: 'acme/site',
    phpConstraint: '^8.3',
    require: {},
    installed,
    lock: 'parsed',
  },
  frameworks: [],
  detectedRunners: [],
  runner: 'local',
  envKeys: null,
});

/** Answers as a machine with no plugin does: non-zero, at once, with nothing written. */
const failingRunner: Runner = {
  id: 'local',
  describe: (args) => `php craft ${args.join(' ')}`,
  exec: () => Promise.resolve({ code: 1, stdout: '', stderr: 'Unknown command: luminx' }),
};

const adapterFor = (installed: Record<string, string> = {}) =>
  createCraftAdapter({ runner: failingRunner, facts: facts(installed) });

const context = (installed: Record<string, string> = {}) => ({
  root: tmpdir(),
  facts: facts(installed),
});

describe('capabilitiesFor', () => {
  // Rich text is a first-party plugin, not core. Claiming it everywhere would fail halfway
  // through an apply rather than during validation (§7.1).
  it('offers richtext only where CKEditor is installed', () => {
    expect(capabilitiesFor(facts()).fieldTypes).not.toContain('richtext');
    expect(capabilitiesFor(facts({ 'craftcms/ckeditor': '4.0.0' })).fieldTypes).toContain(
      'richtext',
    );
  });

  // This test used to assert the opposite, and in doing so it guarded a bug: the adapter claimed
  // navigation whenever the provider was installed, and no NavigationGenerator has ever existed.
  // A capability the plugin cannot deliver dies mid-apply, which is what capabilities are for.
  it('never claims navigation, installed provider or not, because there is no generator', () => {
    expect(capabilitiesFor(facts()).resourceKinds).not.toContain('navigation');
    expect(
      capabilitiesFor(facts({ 'verbb/navigation': '4.0.0-beta.3' })).resourceKinds,
    ).not.toContain('navigation');
  });

  it('always offers the raw escape hatch', () => {
    expect(capabilitiesFor(facts()).fieldTypes).toContain('raw');
  });

  // The handles Craft rejects mid-save. Listing them lets the check fire before the plan (§7.1).
  it('reserves the field handles Craft keeps for itself', () => {
    const reserved = capabilitiesFor(facts()).reservedFieldHandles ?? [];

    expect(reserved).toContain('title');
    expect(reserved).toContain('id');
    expect(reserved).toContain('uid');
    expect(reserved).not.toContain('heading');
  });
});

describe('detect', () => {
  it('reads the installed version from the lock file, not the constraint', async () => {
    const result = await adapterFor({
      'craftcms/cms': 'v5.6.0',
      'luminx/craft-luminx': '0.1.0',
    }).detect(context({ 'craftcms/cms': 'v5.6.0', 'luminx/craft-luminx': '0.1.0' }));

    expect(result.ok && result.value.version).toBe('5.6.0');
    expect(result.ok && result.value.diagnostics['pluginVersion']).toBe('0.1.0');
  });

  it('says this is not a Craft project when Craft is absent', async () => {
    const result = await adapterFor().detect(context());

    expect(!result.ok && result.error.code).toBe('LX2002');
    expect(!result.ok && result.error.hint).toContain('composer install');
  });

  it('says the plugin is missing when only Craft is installed', async () => {
    const installed = { 'craftcms/cms': '5.6.0' };
    const result = await adapterFor(installed).detect(context(installed));

    expect(!result.ok && result.error.code).toBe('LX2003');
    expect(!result.ok && result.error.hint).toContain('composer require');
  });
});

describe('apply and snapshot', () => {
  // The runner answers nothing, so every call fails at the transport. What matters here is that
  // the adapter asks at all, and reports the failure rather than pretending to have written.
  it('report a transport failure rather than claiming success', async () => {
    const adapter = adapterFor();

    const resource = { logicalId: 'field:a' } as never;
    const applied = await adapter.apply(
      { kind: 'skip', resource, reason: 'unchanged' },
      { ...context(), resolved: new Map() },
    );
    expect(applied.ok).toBe(false);

    const snapshot = await adapter.snapshot(context());
    expect(snapshot.ok).toBe(false);
  });
});

describe('toCurrentModel', () => {
  const resource = {
    kind: 'section',
    logicalId: 'section:pages',
    handle: 'pages',
    name: 'Pages',
    spec: { type: 'channel', entryTypes: [] },
    dependsOn: [],
    uid: 'craft-uid-1',
  };

  // The plugin sends no hashes. Both halves of a diff are hashed by one implementation, or every
  // resource looks changed on every run.
  it('hashes the spec with the same hashOf the compiler uses', () => {
    const result = toCurrentModel({ resources: [resource] });

    expect(result.ok && result.value.resources.get('section:pages')?.resource.hash).toBe(
      hashOf(resource.spec),
    );
  });

  it('carries the UID Craft assigned', () => {
    const result = toCurrentModel({ resources: [resource] });
    expect(result.ok && result.value.resources.get('section:pages')?.uid).toBe('craft-uid-1');
  });

  it('is empty for a Craft install with nothing in it', () => {
    const result = toCurrentModel({ resources: [] });
    expect(result.ok && result.value.resources.size).toBe(0);
  });

  it('rejects a payload with no resources array', () => {
    expect(toCurrentModel({}).ok).toBe(false);
    expect(toCurrentModel(null).ok).toBe(false);
  });

  // A newer plugin sending a shape this CLI does not understand must say so. A model that
  // quietly omits half a content model is one the differ reads as "delete it all".
  it('rejects a resource that is missing fields', () => {
    const result = toCurrentModel({ resources: [{ kind: 'section', handle: 'pages' }] });

    expect(!result.ok && result.error.code).toBe('LX3002');
    expect(!result.ok && result.error.hint).toContain('newer than this CLI');
  });

  it('rejects a resource kind it has never heard of', () => {
    const result = toCurrentModel({ resources: [{ ...resource, kind: 'widget' }] });

    expect(!result.ok && result.error.message).toContain('"widget"');
  });
});
