<?php

declare(strict_types=1);

use luminx\craft\Introspect\ArrayGateway;
use luminx\craft\Introspect\Data\CategoryData;
use luminx\craft\Introspect\Data\EntryTypeData;
use luminx\craft\Introspect\Data\FieldData;
use luminx\craft\Introspect\Data\FieldLayoutEntryData;
use luminx\craft\Introspect\Data\FilesystemData;
use luminx\craft\Introspect\Data\GlobalSetData;
use luminx\craft\Introspect\Data\SectionData;
use luminx\craft\Introspect\Data\UserGroupData;
use luminx\craft\Introspect\Data\VolumeData;
use luminx\craft\Introspect\Introspector;

/** @return array<string, array<string, mixed>> */
function byId(array $resources): array
{
    $indexed = [];

    foreach ($resources as $resource) {
        $indexed[$resource['logicalId']] = $resource;
    }

    return $indexed;
}

function gateway(): ArrayGateway
{
    return new ArrayGateway(
        filesystems: [new FilesystemData('u-fs', 'local', 'Local', 'craft\\fs\\Local', '@webroot/uploads', '@web/uploads')],
        volumes: [new VolumeData('u-vol', 'images', 'Images', 'local')],
        fields: [
            new FieldData('u-title', 'title', 'Title', 'craft\\fields\\PlainText', ['charLimit' => 60]),
            new FieldData('u-hero', 'hero', 'Hero', 'craft\\fields\\Assets', ['maxRelations' => 1], ['images']),
        ],
        entryTypes: [
            new EntryTypeData('u-page', 'page', 'Page', [
                new FieldLayoutEntryData('title', true),
                new FieldLayoutEntryData('hero', false, 'Media'),
            ]),
        ],
        sections: [new SectionData('u-pages', 'pages', 'Pages', 'structure', ['page'], 3, '{slug}', 'pages/_entry')],
        categories: [new CategoryData('u-topics', 'topics', 'Topics', 1)],
        globalSets: [new GlobalSetData('u-site', 'siteSettings', 'Site Settings', [new FieldLayoutEntryData('title')])],
        userGroups: [new UserGroupData('u-ed', 'editors', 'Editors', ['viewEntries', 'accessCp'])],
    );
}

$introspector = new Introspector();

it('reports every resource, sorted by logicalId', function () use ($introspector) {
    $ids = array_column($introspector->introspect(gateway()), 'logicalId');

    expect($ids)->toBe([
        'category:topics',
        'entryType:page',
        'field:hero',
        'field:title',
        'filesystem:local',
        'globalSet:siteSettings',
        'section:pages',
        'userGroup:editors',
        'volume:images',
    ]);
});

// The order Craft returns things in is not a property of the model (§13).
it('is deterministic: the same gateway gives the same bytes', function () use ($introspector) {
    $first = json_encode($introspector->introspect(gateway()));
    $second = json_encode($introspector->introspect(gateway()));

    expect($second)->toBe($first);
});

it('carries the UID Craft assigned', function () use ($introspector) {
    expect(byId($introspector->introspect(gateway()))['section:pages']['uid'])->toBe('u-pages');
});

it('makes a volume depend on its filesystem', function () use ($introspector) {
    $volume = byId($introspector->introspect(gateway()))['volume:images'];

    expect($volume['spec'])->toBe(['fs' => 'filesystem:local']);
    expect($volume['dependsOn'])->toBe(['filesystem:local']);
});

it('makes an entry type depend on the fields in its layout', function () use ($introspector) {
    $entryType = byId($introspector->introspect(gateway()))['entryType:page'];

    expect($entryType['spec'])->toBe([
        'fields' => [
            ['field' => 'field:title', 'required' => true],
            ['field' => 'field:hero', 'required' => false, 'tab' => 'Media'],
        ],
    ]);
    expect($entryType['dependsOn'])->toBe(['field:title', 'field:hero']);
});

it('makes a section depend on its entry types', function () use ($introspector) {
    $section = byId($introspector->introspect(gateway()))['section:pages'];

    expect($section['spec'])->toBe([
        'type' => 'structure',
        'entryTypes' => ['entryType:page'],
        'maxLevels' => 3,
        'uriFormat' => '{slug}',
        'template' => 'pages/_entry',
    ]);
    expect($section['dependsOn'])->toBe(['entryType:page']);
});

// A relation field's sources are wired in phase 2, so they are references, not dependencies.
it('gives a relation field no dependencies', function () use ($introspector) {
    $hero = byId($introspector->introspect(gateway()))['field:hero'];

    expect($hero['spec']['sources'])->toBe(['volume:images']);
    expect($hero['dependsOn'])->toBe([]);
});

it('sorts permissions, which are a set and not a list', function () use ($introspector) {
    expect(byId($introspector->introspect(gateway()))['userGroup:editors']['spec'])
        ->toBe(['permissions' => ['accessCp', 'viewEntries']]);
});

it('omits settings the CMS does not have', function () use ($introspector) {
    $topics = byId($introspector->introspect(gateway()))['category:topics'];

    expect($topics['spec'])->toBe(['maxLevels' => 1]);
});

it('restricts the read to the kinds asked for', function () use ($introspector) {
    $ids = array_column($introspector->introspect(gateway(), ['section', 'field']), 'logicalId');

    expect($ids)->toBe(['field:hero', 'field:title', 'section:pages']);
});

it('reports nothing for an empty CMS, rather than failing', function () use ($introspector) {
    expect($introspector->introspect(new ArrayGateway()))->toBe([]);
});
