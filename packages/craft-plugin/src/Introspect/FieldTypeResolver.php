<?php

declare(strict_types=1);

namespace luminx\craft\Introspect;

use luminx\craft\Introspect\Data\FieldData;

/**
 * Craft field class → IR field spec (§6).
 *
 * A pure function over a class name and a settings array. It never touches Craft, which is why
 * every branch below is covered by a test rather than by hope.
 *
 * Anything unrecognised becomes `raw`. That is not a failure: `raw` carries the class and its
 * settings across the wire untouched, so a Super Table or a Neo field survives a round trip
 * without this plugin having to understand it. Guessing would be the failure.
 */
final readonly class FieldTypeResolver
{
    /** Which resource kind a relation field's sources name. Mirrors SOURCE_KIND in the core. */
    private const array SOURCE_KIND = [
        'assets' => 'volume',
        'entries' => 'section',
        'categories' => 'category',
        'users' => 'userGroup',
    ];

    private const array BY_CLASS = [
        'craft\\fields\\PlainText' => 'text',
        'craft\\fields\\Assets' => 'assets',
        'craft\\fields\\Entries' => 'entries',
        'craft\\fields\\Categories' => 'categories',
        'craft\\fields\\Users' => 'users',
        'craft\\fields\\Matrix' => 'matrix',
        'craft\\fields\\Lightswitch' => 'boolean',
        'craft\\fields\\Number' => 'number',
        'craft\\fields\\Date' => 'date',
        'craft\\fields\\Dropdown' => 'dropdown',
        'craft\\fields\\MultiSelect' => 'multiselect',
        'craft\\fields\\Table' => 'table',
        'craft\\fields\\Color' => 'color',
        'craft\\fields\\Money' => 'money',
        'craft\\fields\\Link' => 'link',
        // Rich text lives in a first-party plugin, not in core.
        'craft\\ckeditor\\Field' => 'richtext',
    ];

    /** The IR type this field maps to, or null when nothing does. */
    public function typeOf(string $class): ?string
    {
        return self::BY_CLASS[$class] ?? null;
    }

    /**
     * @return array<string, mixed> The `spec` of an IR field resource.
     */
    public function resolve(FieldData $field): array
    {
        $type = $this->typeOf($field->class);

        if ($type === null) {
            // Keyed by adapter id, exactly as the IR's escape hatch expects.
            return [
                'type' => 'raw',
                'cms' => ['craft' => ['class' => $field->class, 'settings' => $field->settings]],
            ];
        }

        return match ($type) {
            'text' => $this->compact([
                'type' => 'text',
                'max' => $this->positiveInt($field->settings['charLimit'] ?? null),
                'multiline' => $this->bool($field->settings['multiline'] ?? null),
            ]),
            'number' => $this->compact([
                'type' => 'number',
                'min' => $this->number($field->settings['min'] ?? null),
                'max' => $this->number($field->settings['max'] ?? null),
                'decimals' => $this->positiveInt($field->settings['decimals'] ?? null, true),
            ]),
            'boolean' => $this->compact([
                'type' => 'boolean',
                'default' => $this->bool($field->settings['default'] ?? null),
            ]),
            'date' => $this->compact([
                'type' => 'date',
                'showTime' => $this->bool($field->settings['showTime'] ?? null),
            ]),
            'dropdown', 'multiselect' => [
                'type' => $type,
                'options' => $this->options($field->settings['options'] ?? []),
            ],
            'assets', 'entries', 'categories', 'users' => $this->compact([
                'type' => $type,
                'sources' => $this->sourceIds($type, $field->sources),
                'maxRelations' => $this->positiveInt($field->settings['maxRelations'] ?? null),
            ], ['sources']),
            'matrix' => $this->compact([
                'type' => 'matrix',
                'entryTypes' => array_map(
                    static fn (string $handle): string => 'entryType:' . $handle,
                    $field->entryTypeHandles,
                ),
                'minEntries' => $this->positiveInt($field->settings['minEntries'] ?? null, true),
                'maxEntries' => $this->positiveInt($field->settings['maxEntries'] ?? null),
            ], ['entryTypes']),
            'table' => ['type' => 'table', 'columns' => $this->columns($field->settings['columns'] ?? [])],
            'money' => ['type' => 'money', 'currency' => (string) ($field->settings['currency'] ?? 'EUR')],
            default => ['type' => $type],
        };
    }

    /** @return list<string> */
    private function sourceIds(string $type, array $handles): array
    {
        $kind = self::SOURCE_KIND[$type];

        return array_values(array_map(static fn (string $handle): string => $kind . ':' . $handle, $handles));
    }

    /**
     * Drops null settings, so a field Craft left at its default hashes the same as one the
     * config never mentioned. Without this, every introspected field would look changed.
     *
     * @param array<string, mixed> $spec
     * @param list<string> $keep Keys to keep even when empty.
     * @return array<string, mixed>
     */
    private function compact(array $spec, array $keep = []): array
    {
        return array_filter(
            $spec,
            static fn (mixed $value, string $key): bool => $value !== null || in_array($key, $keep, true),
            ARRAY_FILTER_USE_BOTH,
        );
    }

    private function bool(mixed $value): ?bool
    {
        return is_bool($value) ? $value : null;
    }

    private function number(mixed $value): int|float|null
    {
        return is_int($value) || is_float($value) ? $value : null;
    }

    private function positiveInt(mixed $value, bool $allowZero = false): ?int
    {
        if (!is_int($value) && !(is_string($value) && ctype_digit($value))) {
            return null;
        }

        $int = (int) $value;

        return $int > 0 || ($allowZero && $int === 0) ? $int : null;
    }

    /**
     * @param mixed $options
     * @return list<array{value: string, label: string, default?: bool}>
     */
    private function options(mixed $options): array
    {
        if (!is_array($options)) {
            return [];
        }

        $result = [];

        foreach ($options as $option) {
            if (!is_array($option) || !isset($option['value'])) {
                continue;
            }

            $entry = [
                'value' => (string) $option['value'],
                'label' => (string) ($option['label'] ?? $option['value']),
            ];

            if (($option['default'] ?? false) === true) {
                $entry['default'] = true;
            }

            $result[] = $entry;
        }

        return $result;
    }

    /**
     * @param mixed $columns
     * @return list<array{handle: string, heading: string, type: string}>
     */
    private function columns(mixed $columns): array
    {
        if (!is_array($columns)) {
            return [];
        }

        $result = [];

        foreach ($columns as $key => $column) {
            if (!is_array($column)) {
                continue;
            }

            $result[] = [
                'handle' => (string) ($column['handle'] ?? $key),
                'heading' => (string) ($column['heading'] ?? ''),
                'type' => (string) ($column['type'] ?? 'text'),
            ];
        }

        return $result;
    }
}
