<?php

declare(strict_types=1);

namespace luminx\craft\Introspect\Data;

final readonly class EntryTypeData
{
    /** @param list<FieldLayoutEntryData> $fields */
    public function __construct(
        public string $uid,
        public string $handle,
        public string $name,
        public array $fields = [],
    ) {
    }
}
