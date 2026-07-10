<?php

declare(strict_types=1);

namespace luminx\craft\Introspect;

use luminx\craft\Introspect\Data\CategoryData;
use luminx\craft\Introspect\Data\EntryTypeData;
use luminx\craft\Introspect\Data\FieldData;
use luminx\craft\Introspect\Data\FilesystemData;
use luminx\craft\Introspect\Data\GlobalSetData;
use luminx\craft\Introspect\Data\SectionData;
use luminx\craft\Introspect\Data\UserGroupData;
use luminx\craft\Introspect\Data\VolumeData;

/**
 * A gateway over literals. It ships rather than living in `tests/` because it is also how the
 * plugin can be exercised without Craft — the same reason `createMemoryAdapter` ships in core.
 *
 * It is a real implementation of the interface. If the interface is awkward here, it will be
 * worse against Craft's services, and that is worth learning before M7 rather than during it.
 */
final readonly class ArrayGateway implements Gateway
{
    /**
     * @param list<FilesystemData> $filesystems
     * @param list<VolumeData> $volumes
     * @param list<FieldData> $fields
     * @param list<EntryTypeData> $entryTypes
     * @param list<SectionData> $sections
     * @param list<CategoryData> $categories
     * @param list<GlobalSetData> $globalSets
     * @param list<UserGroupData> $userGroups
     */
    public function __construct(
        private array $filesystems = [],
        private array $volumes = [],
        private array $fields = [],
        private array $entryTypes = [],
        private array $sections = [],
        private array $categories = [],
        private array $globalSets = [],
        private array $userGroups = [],
    ) {
    }

    public function filesystems(): array
    {
        return $this->filesystems;
    }

    public function volumes(): array
    {
        return $this->volumes;
    }

    public function fields(): array
    {
        return $this->fields;
    }

    public function entryTypes(): array
    {
        return $this->entryTypes;
    }

    public function sections(): array
    {
        return $this->sections;
    }

    public function categories(): array
    {
        return $this->categories;
    }

    public function globalSets(): array
    {
        return $this->globalSets;
    }

    public function userGroups(): array
    {
        return $this->userGroups;
    }
}
