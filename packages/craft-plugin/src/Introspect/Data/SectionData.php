<?php

declare(strict_types=1);

namespace luminx\craft\Introspect\Data;

final readonly class SectionData
{
    /** @param list<string> $entryTypeHandles */
    public function __construct(
        public string $uid,
        public string $handle,
        public string $name,
        /** `single`, `channel` or `structure`. */
        public string $type,
        public array $entryTypeHandles = [],
        public ?int $maxLevels = null,
        public ?string $uriFormat = null,
        public ?string $template = null,
    ) {
    }
}
