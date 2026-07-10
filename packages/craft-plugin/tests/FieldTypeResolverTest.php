<?php

declare(strict_types=1);

use luminx\craft\Introspect\Data\FieldData;
use luminx\craft\Introspect\FieldTypeResolver;

function field(string $class, array $settings = [], array $sources = [], array $entryTypes = []): FieldData
{
    return new FieldData('uid-1', 'x', 'X', $class, $settings, $sources, $entryTypes);
}

$resolver = new FieldTypeResolver();

it('maps a plain text field, and its settings', function () use ($resolver) {
    expect($resolver->resolve(field('craft\\fields\\PlainText')))->toBe(['type' => 'text']);

    expect($resolver->resolve(field('craft\\fields\\PlainText', ['charLimit' => 60, 'multiline' => true])))
        ->toBe(['type' => 'text', 'max' => 60, 'multiline' => true]);
});

// Craft stores unset settings as null. Keeping them would make a field the config never mentioned
// hash differently from the identical field it describes, and every run would report a change.
it('drops settings Craft left unset', function () use ($resolver) {
    expect($resolver->resolve(field('craft\\fields\\PlainText', ['charLimit' => null, 'multiline' => null])))
        ->toBe(['type' => 'text']);
});

// Found by introspecting a real Craft install: it answers `multiline: false` for every plain text
// field. A config that never mentions multiline compiles to a spec without the key, so reporting
// the false would show that field as changed on every single run, for ever.
it('reports a boolean setting only when it is true', function () use ($resolver) {
    expect($resolver->resolve(field('craft\\fields\\PlainText', ['multiline' => false])))
        ->toBe(['type' => 'text']);

    expect($resolver->resolve(field('craft\\fields\\PlainText', ['multiline' => true])))
        ->toBe(['type' => 'text', 'multiline' => true]);

    expect($resolver->resolve(field('craft\\fields\\Lightswitch', ['default' => false])))
        ->toBe(['type' => 'boolean']);

    expect($resolver->resolve(field('craft\\fields\\Date', ['showTime' => false])))
        ->toBe(['type' => 'date']);
});

it('reads charLimit even when Craft stored it as a string', function () use ($resolver) {
    expect($resolver->resolve(field('craft\\fields\\PlainText', ['charLimit' => '60'])))
        ->toBe(['type' => 'text', 'max' => 60]);
});

it('turns relation sources into logicalIds of the right kind', function () use ($resolver) {
    expect($resolver->resolve(field('craft\\fields\\Assets', [], ['images'])))
        ->toBe(['type' => 'assets', 'sources' => ['volume:images']]);

    expect($resolver->resolve(field('craft\\fields\\Entries', [], ['pages', 'blog'])))
        ->toBe(['type' => 'entries', 'sources' => ['section:pages', 'section:blog']]);

    expect($resolver->resolve(field('craft\\fields\\Categories', [], ['topics'])))
        ->toBe(['type' => 'categories', 'sources' => ['category:topics']]);

    expect($resolver->resolve(field('craft\\fields\\Users', [], ['editors'])))
        ->toBe(['type' => 'users', 'sources' => ['userGroup:editors']]);
});

it('keeps an empty sources list, because the IR always has the key', function () use ($resolver) {
    expect($resolver->resolve(field('craft\\fields\\Assets')))->toBe(['type' => 'assets', 'sources' => []]);
});

it('carries maxRelations when there is one', function () use ($resolver) {
    expect($resolver->resolve(field('craft\\fields\\Assets', ['maxRelations' => 1], ['images'])))
        ->toBe(['type' => 'assets', 'sources' => ['volume:images'], 'maxRelations' => 1]);
});

// Craft 5 nests entry types in a matrix; they are top-level resources in the IR (§9.3).
it('maps a matrix to the entry types it nests', function () use ($resolver) {
    expect($resolver->resolve(field('craft\\fields\\Matrix', ['maxEntries' => 3], [], ['hero', 'faq'])))
        ->toBe([
            'type' => 'matrix',
            'entryTypes' => ['entryType:hero', 'entryType:faq'],
            'maxEntries' => 3,
        ]);
});

it('allows minEntries of zero but not maxEntries of zero', function () use ($resolver) {
    $spec = $resolver->resolve(field('craft\\fields\\Matrix', ['minEntries' => 0, 'maxEntries' => 0], [], ['a']));

    expect($spec)->toHaveKey('minEntries')->and($spec['minEntries'])->toBe(0);
    expect($spec)->not->toHaveKey('maxEntries');
});

it('maps dropdown options, and marks the default', function () use ($resolver) {
    $options = [
        ['value' => 'a', 'label' => 'A'],
        ['value' => 'b', 'label' => 'B', 'default' => true],
    ];

    expect($resolver->resolve(field('craft\\fields\\Dropdown', ['options' => $options])))
        ->toBe([
            'type' => 'dropdown',
            'options' => [
                ['value' => 'a', 'label' => 'A'],
                ['value' => 'b', 'label' => 'B', 'default' => true],
            ],
        ]);
});

it('maps the simple types', function () use ($resolver) {
    expect($resolver->resolve(field('craft\\fields\\Color')))->toBe(['type' => 'color']);
    expect($resolver->resolve(field('craft\\fields\\Link')))->toBe(['type' => 'link']);
    expect($resolver->resolve(field('craft\\fields\\Lightswitch', ['default' => true])))
        ->toBe(['type' => 'boolean', 'default' => true]);
    expect($resolver->resolve(field('craft\\fields\\Date', ['showTime' => true])))
        ->toBe(['type' => 'date', 'showTime' => true]);
    expect($resolver->resolve(field('craft\\fields\\Money', ['currency' => 'USD'])))
        ->toBe(['type' => 'money', 'currency' => 'USD']);
    expect($resolver->resolve(field('craft\\ckeditor\\Field')))->toBe(['type' => 'richtext']);
});

// The escape hatch (§6). Guessing would be the failure; carrying it across untouched is not.
it('falls back to raw for a field it does not know, keeping the class and settings', function () use ($resolver) {
    $spec = $resolver->resolve(field('verbb\\supertable\\fields\\SuperTableField', ['columns' => 3]));

    expect($spec)->toBe([
        'type' => 'raw',
        'cms' => [
            'craft' => [
                'class' => 'verbb\\supertable\\fields\\SuperTableField',
                'settings' => ['columns' => 3],
            ],
        ],
    ]);
});

it('knows which classes it can map', function () use ($resolver) {
    expect($resolver->typeOf('craft\\fields\\PlainText'))->toBe('text');
    expect($resolver->typeOf('nobody\\knows\\This'))->toBeNull();
});
