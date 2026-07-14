<?php

declare(strict_types=1);

namespace luminx\craft\Apply\Generators;

use Craft;
use craft\elements\Entry;
use craft\fieldlayoutelements\CustomField;
use craft\fieldlayoutelements\entries\EntryTitleField;
use craft\models\EntryType;
use craft\models\FieldLayout;
use craft\models\FieldLayoutTab;
use luminx\craft\Apply\ApplyContext;
use luminx\craft\Apply\ApplyException;
use luminx\craft\Apply\Generator;

/**
 * The field layout is rebuilt whole from the IR, in the order the config gives, so the layout is
 * deterministic: same config, same tabs, same order (§9.3).
 */
final readonly class EntryTypeGenerator implements Generator
{
    public function kind(): string
    {
        return 'entryType';
    }

    public function apply(array $resource, ApplyContext $context): string
    {
        $handle = (string) $resource['handle'];
        $spec = (array) $resource['spec'];

        $entryType = Craft::$app->getEntries()->getEntryTypeByHandle($handle) ?? new EntryType();
        $entryType->handle = $handle;
        $entryType->name = (string) $resource['name'];
        $entryType->setFieldLayout($this->layout((array) ($spec['fields'] ?? []), $resource['logicalId']));

        if (!Craft::$app->getEntries()->saveEntryType($entryType)) {
            throw ApplyException::invalid($resource['logicalId'], $entryType->getErrors());
        }

        return (string) $entryType->uid;
    }

    public function delete(array $resource, string $uid): void
    {
        $entryType = Craft::$app->getEntries()->getEntryTypeByHandle((string) $resource['handle']);

        if ($entryType !== null) {
            Craft::$app->getEntries()->deleteEntryType($entryType);
        }
    }

    /** @param list<array{field: string, required: bool, tab?: string}> $entries */
    private function layout(array $entries, string $logicalId): FieldLayout
    {
        $layout = new FieldLayout(['type' => Entry::class]);

        /**
         * The title is a layout element, not a setting — and leaving it out silently costs you every
         * title you write.
         *
         * `Entries::saveEntryType()` derives the flag from the layout:
         *
         *     $entryType->hasTitleField = $entryType->getFieldLayout()->isFieldIncluded('title');
         *
         * A layout of nothing but custom fields therefore turns the title *off*, and an entry type
         * with no title field ignores the title on every entry saved to it. `luminx content push`
         * wrote six articles, Craft accepted all six, and every one of them landed with a NULL
         * title. Nothing failed. That is the worst way for this to go wrong.
         *
         * Not mandatory, so a matrix block — an entry type too — is not forced to carry one.
         * LuminX's own generated types promise `title` on every entry (LuminxEntry); this is what
         * makes that promise true.
         */
        $elements = [new EntryTitleField(['required' => false])];

        /** @var array<string, list<CustomField>> $byTab */
        $byTab = [];

        foreach ($entries as $entry) {
            $handle = ApplyContext::handleOf((string) $entry['field']);
            $field = Craft::$app->getFields()->getFieldByHandle($handle);

            if ($field === null) {
                throw ApplyException::failed($logicalId, sprintf('field "%s" does not exist yet', $handle));
            }

            $tab = (string) ($entry['tab'] ?? 'Content');
            $byTab[$tab][] = new CustomField($field, ['required' => (bool) ($entry['required'] ?? false)]);
        }

        $tabs = [];
        $first = true;

        foreach ($byTab as $name => $fields) {
            $tab = new FieldLayoutTab(['name' => $name, 'layout' => $layout]);
            $tab->setElements($first ? [...$elements, ...$fields] : $fields);
            $tabs[] = $tab;
            $first = false;
        }

        // An entry type with no fields at all still needs somewhere to put its title.
        if ($tabs === []) {
            $tab = new FieldLayoutTab(['name' => 'Content', 'layout' => $layout]);
            $tab->setElements($elements);
            $tabs[] = $tab;
        }

        $layout->setTabs($tabs);

        return $layout;
    }
}
