<?php

declare(strict_types=1);

namespace luminx\craft\Apply;

/**
 * What a generator is allowed to know while applying one operation.
 *
 * `resolved` maps logicalId to the UID the CMS gave it. It is how one resource learns another's
 * UID without any generator ever calling another generator (§9.2). Phase 2 is nothing but this
 * map, filled in.
 */
final readonly class ApplyContext
{
    /** @param array<string, string> $resolved logicalId → UID */
    public function __construct(
        public array $resolved = [],
        public int $phase = 1,
    ) {
    }

    public function uidOf(string $logicalId): ?string
    {
        return $this->resolved[$logicalId] ?? null;
    }

    /** `section:pages` → `pages`. The IR speaks logicalIds; Craft speaks handles. */
    public static function handleOf(string $logicalId): string
    {
        $parts = explode(':', $logicalId, 2);

        return $parts[1] ?? $logicalId;
    }
}
