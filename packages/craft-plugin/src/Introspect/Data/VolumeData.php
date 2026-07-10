<?php

declare(strict_types=1);

namespace luminx\craft\Introspect\Data;

final readonly class VolumeData
{
    public function __construct(
        public string $uid,
        public string $handle,
        public string $name,
        /** Handle of the filesystem this volume writes to. */
        public string $fsHandle,
        public ?string $subpath = null,
    ) {
    }
}
