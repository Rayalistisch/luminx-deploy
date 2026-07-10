<?php

declare(strict_types=1);

namespace luminx\craft\Apply\Generators;

use Craft;
use craft\models\CategoryGroup;
use craft\models\CategoryGroup_SiteSettings;
use luminx\craft\Apply\ApplyContext;
use luminx\craft\Apply\ApplyException;
use luminx\craft\Apply\Generator;

final readonly class CategoryGenerator implements Generator
{
    public function kind(): string
    {
        return 'category';
    }

    public function apply(array $resource, ApplyContext $context): string
    {
        $handle = (string) $resource['handle'];
        $spec = (array) $resource['spec'];

        $group = Craft::$app->getCategories()->getGroupByHandle($handle) ?? new CategoryGroup();
        $group->handle = $handle;
        $group->name = (string) $resource['name'];

        if (isset($spec['maxLevels'])) {
            $group->maxLevels = (int) $spec['maxLevels'];
        }

        $hasUrls = isset($spec['uriFormat']);
        $settings = [];

        foreach (Craft::$app->getSites()->getAllSites() as $site) {
            $settings[$site->id] = new CategoryGroup_SiteSettings([
                'siteId' => $site->id,
                'hasUrls' => $hasUrls,
                'uriFormat' => $spec['uriFormat'] ?? null,
                'template' => $spec['template'] ?? null,
            ]);
        }

        $group->setSiteSettings($settings);

        if (!Craft::$app->getCategories()->saveGroup($group)) {
            throw ApplyException::invalid($resource['logicalId'], $group->getErrors());
        }

        return (string) $group->uid;
    }

    public function delete(array $resource, string $uid): void
    {
        $group = Craft::$app->getCategories()->getGroupByHandle((string) $resource['handle']);

        if ($group !== null) {
            Craft::$app->getCategories()->deleteGroupById((int) $group->id);
        }
    }
}
