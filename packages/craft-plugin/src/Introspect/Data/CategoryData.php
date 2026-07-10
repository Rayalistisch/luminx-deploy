<?php

declare(strict_types=1);

namespace luminx\craft\Introspect\Data;

final readonly class CategoryData
{
    public function __construct(
        public string $uid,
        public string $handle,
        public string $name,
        public ?int $maxLevels = null,
        public ?string $uriFormat = null,
        public ?string $template = null,
    ) {
    }
}
