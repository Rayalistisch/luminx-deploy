<?php

declare(strict_types=1);

namespace luminx\craft\Apply\Generators;

use Craft;
use craft\models\EntryType;
use craft\models\Section;
use craft\models\Section_SiteSettings;
use luminx\craft\Apply\ApplyContext;
use luminx\craft\Apply\ApplyException;
use luminx\craft\Apply\Generator;

/**
 * `entryTypes` is a required rule on Craft's Section, and `uriFormat` and `template` live on the
 * per-site settings rather than on the section. Both facts shaped the IR; see phases.ts and the
 * note in CraftGateway.
 */
final readonly class SectionGenerator implements Generator
{
    public function kind(): string
    {
        return 'section';
    }

    public function apply(array $resource, ApplyContext $context): string
    {
        $handle = (string) $resource['handle'];
        $spec = (array) $resource['spec'];

        $section = Craft::$app->getEntries()->getSectionByHandle($handle) ?? new Section();
        $section->handle = $handle;
        $section->name = (string) $resource['name'];
        $section->type = (string) $spec['type'];

        if (isset($spec['maxLevels'])) {
            $section->maxLevels = (int) $spec['maxLevels'];
        }

        $section->setEntryTypes($this->entryTypes((array) $spec['entryTypes'], $resource['logicalId']));
        $section->setSiteSettings($this->siteSettings($spec));

        if (!Craft::$app->getEntries()->saveSection($section)) {
            throw ApplyException::invalid($resource['logicalId'], $section->getErrors());
        }

        return (string) $section->uid;
    }

    public function delete(array $resource, string $uid): void
    {
        $section = Craft::$app->getEntries()->getSectionByHandle((string) $resource['handle']);

        if ($section !== null) {
            Craft::$app->getEntries()->deleteSection($section);
        }
    }

    /**
     * @param list<string> $logicalIds
     * @return list<EntryType>
     */
    private function entryTypes(array $logicalIds, string $logicalId): array
    {
        $entryTypes = [];

        foreach ($logicalIds as $id) {
            $entryType = Craft::$app->getEntries()->getEntryTypeByHandle(ApplyContext::handleOf((string) $id));

            if ($entryType === null) {
                throw ApplyException::failed($logicalId, sprintf('entry type "%s" does not exist yet', $id));
            }

            $entryTypes[] = $entryType;
        }

        return $entryTypes;
    }

    /**
     * The IR has one uriFormat per section; Craft has one per site. Every site gets the same
     * value. A multi-site project whose sections differ per site is not something v1 models, and
     * saying so beats writing one site's URI format over another's.
     *
     * @param array<string, mixed> $spec
     * @return array<int, Section_SiteSettings>
     */
    private function siteSettings(array $spec): array
    {
        $hasUrls = isset($spec['uriFormat']);
        $settings = [];

        foreach (Craft::$app->getSites()->getAllSites() as $site) {
            $settings[$site->id] = new Section_SiteSettings([
                'siteId' => $site->id,
                'enabledByDefault' => true,
                'hasUrls' => $hasUrls,
                'uriFormat' => $spec['uriFormat'] ?? null,
                'template' => $spec['template'] ?? null,
            ]);
        }

        return $settings;
    }
}
