<?php

declare(strict_types=1);

namespace luminx\craft\Apply\Generators;

use Craft;
use craft\elements\GlobalSet;
use craft\fieldlayoutelements\CustomField;
use craft\models\FieldLayout;
use craft\models\FieldLayoutTab;
use luminx\craft\Apply\ApplyContext;
use luminx\craft\Apply\ApplyException;
use luminx\craft\Apply\Generator;

final readonly class GlobalSetGenerator implements Generator
{
    public function kind(): string
    {
        return 'globalSet';
    }

    public function apply(array $resource, ApplyContext $context): string
    {
        $handle = (string) $resource['handle'];
        $spec = (array) $resource['spec'];

        $set = Craft::$app->getGlobals()->getSetByHandle($handle) ?? new GlobalSet();
        $set->handle = $handle;
        $set->name = (string) $resource['name'];

        $layout = new FieldLayout(['type' => GlobalSet::class]);
        $elements = [];

        foreach ((array) ($spec['fields'] ?? []) as $entry) {
            $fieldHandle = ApplyContext::handleOf((string) $entry['field']);
            $field = Craft::$app->getFields()->getFieldByHandle($fieldHandle);

            if ($field === null) {
                throw ApplyException::failed($resource['logicalId'], sprintf('field "%s" does not exist yet', $fieldHandle));
            }

            $elements[] = new CustomField($field, ['required' => (bool) ($entry['required'] ?? false)]);
        }

        $tab = new FieldLayoutTab(['name' => 'Content', 'layout' => $layout]);
        $tab->setElements($elements);
        $layout->setTabs([$tab]);
        $set->setFieldLayout($layout);

        if (!Craft::$app->getElements()->saveElement($set)) {
            throw ApplyException::invalid($resource['logicalId'], $set->getErrors());
        }

        return (string) $set->uid;
    }

    public function delete(array $resource, string $uid): void
    {
        $set = Craft::$app->getGlobals()->getSetByHandle((string) $resource['handle']);

        if ($set !== null) {
            Craft::$app->getElements()->deleteElement($set);
        }
    }
}
