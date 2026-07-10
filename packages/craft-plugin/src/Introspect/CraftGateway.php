<?php

declare(strict_types=1);

namespace luminx\craft\Introspect;

use Craft;
use craft\base\FieldInterface;
use craft\elements\GlobalSet;
use craft\fieldlayoutelements\CustomField;
use craft\fields\Assets;
use craft\fields\Categories;
use craft\fields\Entries;
use craft\fields\Matrix;
use craft\fields\Users;
use craft\models\CategoryGroup;
use craft\models\EntryType;
use craft\models\FieldLayout;
use craft\models\Section;
use craft\models\UserGroup;
use craft\models\Volume;
use luminx\craft\Introspect\Data\CategoryData;
use luminx\craft\Introspect\Data\EntryTypeData;
use luminx\craft\Introspect\Data\FieldData;
use luminx\craft\Introspect\Data\FieldLayoutEntryData;
use luminx\craft\Introspect\Data\FilesystemData;
use luminx\craft\Introspect\Data\GlobalSetData;
use luminx\craft\Introspect\Data\SectionData;
use luminx\craft\Introspect\Data\UserGroupData;
use luminx\craft\Introspect\Data\VolumeData;

/**
 * The only class here that talks to Craft, and the only one with no unit test.
 *
 * A test of it without a booted Craft would test nothing — its whole job is to call Craft's
 * services and translate what comes back. It is verified against a real installation in M7. That
 * is precisely why everything that *decides* anything lives behind the Gateway interface instead.
 *
 * It resolves UIDs to handles here. The IR speaks handles, and a UID means nothing to a human
 * reading a plan.
 *
 * Read-only. `Craft::$app` is asked, never told.
 */
final readonly class CraftGateway implements Gateway
{
    public function filesystems(): array
    {
        return array_values(array_map(
            static fn ($fs): FilesystemData => new FilesystemData(
                uid: (string) $fs->uid,
                handle: (string) $fs->handle,
                name: (string) $fs->name,
                type: $fs::class,
                path: (string) ($fs->path ?? ''),
                url: $fs->hasUrls ? (string) $fs->url : null,
            ),
            Craft::$app->getFs()->getAllFilesystems(),
        ));
    }

    public function volumes(): array
    {
        return array_values(array_map(
            static fn (Volume $volume): VolumeData => new VolumeData(
                uid: (string) $volume->uid,
                handle: (string) $volume->handle,
                name: (string) $volume->name,
                fsHandle: (string) $volume->getFsHandle(),
                subpath: $volume->subpath === '' ? null : $volume->subpath,
            ),
            Craft::$app->getVolumes()->getAllVolumes(),
        ));
    }

    public function fields(): array
    {
        return array_values(array_map(
            fn (FieldInterface $field): FieldData => new FieldData(
                uid: (string) $field->uid,
                handle: (string) $field->handle,
                name: (string) $field->name,
                class: $field::class,
                settings: $field->getSettings(),
                sources: $this->sourcesOf($field),
                entryTypeHandles: $this->matrixEntryTypesOf($field),
            ),
            Craft::$app->getFields()->getAllFields(),
        ));
    }

    public function entryTypes(): array
    {
        return array_values(array_map(
            fn (EntryType $entryType): EntryTypeData => new EntryTypeData(
                uid: (string) $entryType->uid,
                handle: (string) $entryType->handle,
                name: (string) $entryType->name,
                fields: $this->layoutOf($entryType->getFieldLayout()),
            ),
            Craft::$app->getEntries()->getAllEntryTypes(),
        ));
    }

    public function sections(): array
    {
        return array_values(array_map(
            fn (Section $section): SectionData => new SectionData(
                uid: (string) $section->uid,
                handle: (string) $section->handle,
                name: (string) $section->name,
                type: (string) $section->type,
                entryTypeHandles: array_values(array_map(
                    static fn (EntryType $entryType): string => (string) $entryType->handle,
                    $section->getEntryTypes(),
                )),
                maxLevels: $section->maxLevels,
                uriFormat: $this->primarySiteSetting($section->getSiteSettings(), 'uriFormat'),
                template: $this->primarySiteSetting($section->getSiteSettings(), 'template'),
            ),
            Craft::$app->getEntries()->getAllSections(),
        ));
    }

    public function categories(): array
    {
        return array_values(array_map(
            fn (CategoryGroup $group): CategoryData => new CategoryData(
                uid: (string) $group->uid,
                handle: (string) $group->handle,
                name: (string) $group->name,
                maxLevels: $group->maxLevels,
                uriFormat: $this->primarySiteSetting($group->getSiteSettings(), 'uriFormat'),
                template: $this->primarySiteSetting($group->getSiteSettings(), 'template'),
            ),
            Craft::$app->getCategories()->getAllGroups(),
        ));
    }

    /**
     * In Craft, `uriFormat` and `template` are per site; in the IR they sit on the section (§5.1).
     * We report the primary site's value.
     *
     * That is a deliberate narrowing, and it has a consequence worth naming: a multi-site project
     * whose sections differ per site will look, to `luminx sync`, as though the non-primary sites
     * do not exist. LuminX does not manage them and will not silently overwrite them. Modelling
     * per-site settings needs `sites` to become a resource kind, which v1 does not do.
     *
     * @param array<int, object> $siteSettings
     */
    private function primarySiteSetting(array $siteSettings, string $property): ?string
    {
        $primaryId = Craft::$app->getSites()->getPrimarySite()->id;
        $settings = $siteSettings[$primaryId] ?? reset($siteSettings);

        if ($settings === false) {
            return null;
        }

        $value = $settings->{$property} ?? null;

        return is_string($value) && $value !== '' ? $value : null;
    }

    public function globalSets(): array
    {
        return array_values(array_map(
            fn (GlobalSet $set): GlobalSetData => new GlobalSetData(
                uid: (string) $set->uid,
                handle: (string) $set->handle,
                name: (string) $set->name,
                fields: $this->layoutOf($set->getFieldLayout()),
            ),
            Craft::$app->getGlobals()->getAllSets(),
        ));
    }

    public function userGroups(): array
    {
        $permissions = Craft::$app->getUserPermissions();

        return array_values(array_map(
            static fn (UserGroup $group): UserGroupData => new UserGroupData(
                uid: (string) $group->uid,
                handle: (string) $group->handle,
                name: (string) $group->name,
                permissions: array_values($permissions->getPermissionsByGroupId((int) $group->id)),
            ),
            Craft::$app->getUserGroups()->getAllGroups(),
        ));
    }

    /** @return list<FieldLayoutEntryData> */
    private function layoutOf(?FieldLayout $layout): array
    {
        if ($layout === null) {
            return [];
        }

        $entries = [];

        foreach ($layout->getTabs() as $tab) {
            foreach ($tab->getElements() as $element) {
                if (!$element instanceof CustomField) {
                    continue;
                }

                $field = $element->getField();

                $entries[] = new FieldLayoutEntryData(
                    fieldHandle: (string) $field->handle,
                    required: (bool) $element->required,
                    tab: (string) $tab->name,
                );
            }
        }

        return $entries;
    }

    /**
     * Craft stores relation sources as `volume:<uid>`, or the string `*` for "everything". The IR
     * speaks handles, so the UIDs are resolved here — the one place that can.
     *
     * `*` becomes an empty list rather than an invented enumeration of everything that exists
     * today: a config that says "all volumes" and one that lists them is not the same statement.
     *
     * @return list<string>
     */
    private function sourcesOf(FieldInterface $field): array
    {
        if (!$field instanceof Assets && !$field instanceof Entries
            && !$field instanceof Categories && !$field instanceof Users) {
            return [];
        }

        $sources = $field->sources;

        if (!is_array($sources)) {
            return [];
        }

        $handles = [];

        foreach ($sources as $source) {
            $parts = explode(':', (string) $source, 2);

            if (count($parts) !== 2) {
                continue;
            }

            $handle = $this->handleForSourceUid($field, $parts[1]);

            if ($handle !== null) {
                $handles[] = $handle;
            }
        }

        return $handles;
    }

    /**
     * The field decides what a source UID means, not the prefix.
     *
     * Craft writes `group:<uid>` for both a category group and a user group. Resolving by prefix
     * would look a user group up among the categories, find nothing, and silently drop the source
     * — leaving a field that points at editors looking like a field that points at nothing.
     */
    private function handleForSourceUid(FieldInterface $field, string $uid): ?string
    {
        return match (true) {
            $field instanceof Assets => Craft::$app->getVolumes()->getVolumeByUid($uid)?->handle,
            $field instanceof Entries => Craft::$app->getEntries()->getSectionByUid($uid)?->handle,
            $field instanceof Categories => Craft::$app->getCategories()->getGroupByUid($uid)?->handle,
            $field instanceof Users => Craft::$app->getUserGroups()->getGroupByUid($uid)?->handle,
            default => null,
        };
    }

    /** @return list<string> */
    private function matrixEntryTypesOf(FieldInterface $field): array
    {
        if (!$field instanceof Matrix) {
            return [];
        }

        return array_values(array_map(
            static fn (EntryType $entryType): string => (string) $entryType->handle,
            $field->getEntryTypes(),
        ));
    }
}
