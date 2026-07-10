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
 * Everything the Introspector needs to know about the CMS, and nothing about how to ask.
 *
 * This is the seam. `CraftGateway` implements it against Craft's services and can only run
 * inside a booted application; `ArrayGateway` implements it from literals and runs in a test.
 * The mapping to the IR sits behind both, and is exercised by the second.
 *
 * Read-only by construction. There is no way to write anything through this interface, which is
 * what makes M6 impossible to get destructively wrong.
 */
interface Gateway
{
    /** @return list<FilesystemData> */
    public function filesystems(): array;

    /** @return list<VolumeData> */
    public function volumes(): array;

    /** @return list<FieldData> */
    public function fields(): array;

    /** @return list<EntryTypeData> */
    public function entryTypes(): array;

    /** @return list<SectionData> */
    public function sections(): array;

    /** @return list<CategoryData> */
    public function categories(): array;

    /** @return list<GlobalSetData> */
    public function globalSets(): array;

    /** @return list<UserGroupData> */
    public function userGroups(): array;
}
