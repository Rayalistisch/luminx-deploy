import { hashOf } from '@luminx/core';
import type { ProjectFacts } from '@luminx/shared';
import { describe, expect, it } from 'vitest';

import { capabilitiesFor, createCraftAdapter } from './adapter.js';
import type { Runner } from './runner.js';
import { toCurrentModel } from './translate.js';

const facts = (installed: Record<string, string> = {}): ProjectFacts => ({
  root: '/project',
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

const silentRunner: Runner = {
  id: 'local',
  describe: (args) => `php craft ${args.join(' ')}`,
  exec: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
};

const adapterFor = (installed: Record<string, string> = {}) =>
  createCraftAdapter({ runner: silentRunner, facts: facts(installed) });

const context = (installed: Record<string, string> = {}) => ({
  root: '/project',
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

  // Craft has no navigation in core (§9.4).
  it('offers navigation only where a provider is installed', () => {
    expect(capabilitiesFor(facts()).resourceKinds).not.toContain('navigation');
    expect(capabilitiesFor(facts({ 'verbb/navigation': '3.0.1' })).resourceKinds).toContain(
      'navigation',
    );
  });

  it('always offers the raw escape hatch', () => {
    expect(capabilitiesFor(facts()).fieldTypes).toContain('raw');
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

describe('apply, snapshot, restore', () => {
  // Exiting 0 having written nothing would be a lie a pipeline believes.
  it('refuse, naming the milestone that brings them', async () => {
    const adapter = adapterFor();
    const applyContext = { ...context(), resolved: new Map() };

    const applied = await adapter.apply(
      { kind: 'skip', resource: {} as never, reason: 'unchanged' },
      applyContext,
    );
    expect(!applied.ok && applied.error.message).toContain('M8');

    const snapshot = await adapter.snapshot(context());
    expect(!snapshot.ok && snapshot.error.message).toContain('M8');
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
