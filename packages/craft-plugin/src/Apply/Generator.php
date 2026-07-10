<?php

declare(strict_types=1);

namespace luminx\craft\Apply;

/**
 * One resource kind, created or updated (§9.2).
 *
 * Every generator is independent and knows nothing of any other. When a section needs its entry
 * types' UIDs it takes them from `ApplyContext`, which the core filled in — never by reaching for
 * another generator. That is precisely why phase 2 exists.
 *
 * Idempotent, always: applying the same operation twice must leave the CMS as it was after the
 * first. `generate` run twice reports skips only because of this.
 */
interface Generator
{
    /** The ResourceKind this generator handles. */
    public function kind(): string;

    /**
     * @param array<string, mixed> $resource The IR resource, as the CLI sent it.
     * @return string The UID the CMS assigned.
     */
    public function apply(array $resource, ApplyContext $context): string;

    /** Removes it. Only ever reached under `--prune` (§8.2). */
    public function delete(array $resource, string $uid): void;
}
