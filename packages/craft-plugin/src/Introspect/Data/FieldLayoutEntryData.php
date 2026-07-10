<?php

declare(strict_types=1);

namespace luminx\craft\Introspect\Data;

final readonly class FieldLayoutEntryData
{
    public function __construct(
        public string $fieldHandle,
        public bool $required = false,
        public ?string $tab = null,
    ) {
    }
}
