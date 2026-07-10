<?php

declare(strict_types=1);

namespace luminx\craft\Introspect\Data;

final readonly class UserGroupData
{
    /** @param list<string> $permissions */
    public function __construct(
        public string $uid,
        public string $handle,
        public string $name,
        public array $permissions = [],
    ) {
    }
}
