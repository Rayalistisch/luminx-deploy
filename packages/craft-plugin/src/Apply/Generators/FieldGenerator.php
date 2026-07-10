<?php

declare(strict_types=1);

namespace luminx\craft\Apply\Generators;

use Craft;
use craft\base\FieldInterface;
use craft\fields\Assets;
use craft\fields\Categories;
use craft\fields\Color;
use craft\fields\Date;
use craft\fields\Dropdown;
use craft\fields\Entries;
use craft\fields\Lightswitch;
use craft\fields\Link;
use craft\fields\Matrix;
use craft\fields\Money;
use craft\fields\MultiSelect;
use craft\fields\Number;
use craft\fields\PlainText;
use craft\fields\Table;
use craft\fields\Users;
use luminx\craft\Apply\ApplyContext;
use luminx\craft\Apply\ApplyException;
use luminx\craft\Apply\Generator;

/**
 * IR field type → Craft field. The inverse of FieldTypeResolver, and it must stay the inverse:
 * whatever this writes, introspection has to read back identically, or the next `generate` sees a
 * change that nobody made.
 */
final readonly class FieldGenerator implements Generator
{
    private const array CLASSES = [
        'text' => PlainText::class,
        'number' => Number::class,
        'boolean' => Lightswitch::class,
        'date' => Date::class,
        'dropdown' => Dropdown::class,
        'multiselect' => MultiSelect::class,
        'assets' => Assets::class,
        'entries' => Entries::class,
        'categories' => Categories::class,
        'users' => Users::class,
        'matrix' => Matrix::class,
        'table' => Table::class,
        'color' => Color::class,
        'money' => Money::class,
        'link' => Link::class,
        'richtext' => 'craft\\ckeditor\\Field',
    ];

    /** Craft prefixes a relation source with the kind of thing it points at. */
    private const array SOURCE_PREFIX = [
        'assets' => 'volume',
        'entries' => 'section',
        // Category groups and user groups share `group:`. The field type tells them apart.
        'categories' => 'group',
        'users' => 'group',
    ];

    public function kind(): string
    {
        return 'field';
    }

    public function apply(array $resource, ApplyContext $context): string
    {
        $handle = (string) $resource['handle'];
        $spec = (array) $resource['spec'];
        $type = (string) $spec['type'];

        $existing = Craft::$app->getFields()->getFieldByHandle($handle);
        $field = $existing instanceof FieldInterface && $existing::class === $this->classFor($spec)
            ? $existing
            : $this->instantiate($spec, $resource['logicalId']);

        $field->handle = $handle;
        $field->name = (string) $resource['name'];

        $this->applySettings($field, $type, $spec, $context);

        if (!Craft::$app->getFields()->saveField($field)) {
            throw ApplyException::invalid($resource['logicalId'], $field->getErrors());
        }

        return (string) $field->uid;
    }

    public function delete(array $resource, string $uid): void
    {
        $field = Craft::$app->getFields()->getFieldByHandle((string) $resource['handle']);

        if ($field !== null) {
            Craft::$app->getFields()->deleteField($field);
        }
    }

    /** @param array<string, mixed> $spec */
    private function classFor(array $spec): string
    {
        $type = (string) $spec['type'];

        if ($type === 'raw') {
            /** @var array{craft?: array{class?: string}} $cms */
            $cms = (array) ($spec['cms'] ?? []);

            return (string) ($cms['craft']['class'] ?? '');
        }

        return self::CLASSES[$type] ?? '';
    }

    /** @param array<string, mixed> $spec */
    private function instantiate(array $spec, string $logicalId): FieldInterface
    {
        $class = $this->classFor($spec);

        if ($class === '' || !class_exists($class)) {
            throw ApplyException::failed(
                $logicalId,
                sprintf('no Craft field class for "%s"%s', $spec['type'], $class === '' ? '' : " ({$class})"),
            );
        }

        /** @var FieldInterface $field */
        $field = new $class();

        return $field;
    }

    /** @param array<string, mixed> $spec */
    private function applySettings(FieldInterface $field, string $type, array $spec, ApplyContext $context): void
    {
        switch ($type) {
            case 'text':
                $field->charLimit = $spec['max'] ?? null;
                $field->multiline = (bool) ($spec['multiline'] ?? false);
                break;

            case 'number':
                $field->min = $spec['min'] ?? null;
                $field->max = $spec['max'] ?? null;
                $field->decimals = (int) ($spec['decimals'] ?? 0);
                break;

            case 'boolean':
                $field->default = (bool) ($spec['default'] ?? false);
                break;

            case 'date':
                $field->showTime = (bool) ($spec['showTime'] ?? false);
                break;

            case 'dropdown':
            case 'multiselect':
                $field->options = array_map(
                    static fn (array $option): array => [
                        'label' => (string) $option['label'],
                        'value' => (string) $option['value'],
                        'default' => ($option['default'] ?? false) === true ? '1' : '',
                    ],
                    (array) ($spec['options'] ?? []),
                );
                break;

            case 'assets':
            case 'entries':
            case 'categories':
            case 'users':
                $field->sources = $this->sourcesFor($type, (array) ($spec['sources'] ?? []), $context);

                if (isset($spec['maxRelations'])) {
                    $field->maxRelations = (int) $spec['maxRelations'];
                }
                break;

            case 'matrix':
                $field->setEntryTypes($this->entryTypesFor((array) ($spec['entryTypes'] ?? [])));

                if (isset($spec['minEntries'])) {
                    $field->minEntries = (int) $spec['minEntries'];
                }
                if (isset($spec['maxEntries'])) {
                    $field->maxEntries = (int) $spec['maxEntries'];
                }
                break;

            case 'money':
                $field->currency = (string) $spec['currency'];
                break;

            case 'table':
                $field->columns = (array) ($spec['columns'] ?? []);
                break;

            case 'raw':
                /** @var array{craft?: array{settings?: array<string, mixed>}} $cms */
                $cms = (array) ($spec['cms'] ?? []);
                // Handed over untouched. The core hashed it; it never looked inside.
                $field->setAttributes((array) ($cms['craft']['settings'] ?? []), false);
                break;
        }
    }

    /**
     * Phase 2. A source whose UID is not yet known is dropped rather than written wrong: phase 1
     * created this field with none, and the phase-2 operation fills them in once they exist.
     *
     * @param list<string> $sources logicalIds
     * @return list<string>
     */
    private function sourcesFor(string $type, array $sources, ApplyContext $context): array
    {
        $prefix = self::SOURCE_PREFIX[$type];
        $resolved = [];

        foreach ($sources as $logicalId) {
            $uid = $context->uidOf((string) $logicalId);

            if ($uid !== null) {
                $resolved[] = $prefix . ':' . $uid;
            }
        }

        return $resolved;
    }

    /**
     * @param list<string> $logicalIds
     * @return list<\craft\models\EntryType>
     */
    private function entryTypesFor(array $logicalIds): array
    {
        $entryTypes = [];

        foreach ($logicalIds as $logicalId) {
            $entryType = Craft::$app->getEntries()->getEntryTypeByHandle(
                ApplyContext::handleOf((string) $logicalId),
            );

            if ($entryType === null) {
                throw ApplyException::failed((string) $logicalId, 'the entry type does not exist yet');
            }

            $entryTypes[] = $entryType;
        }

        return $entryTypes;
    }
}
