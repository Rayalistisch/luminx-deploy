<?php

declare(strict_types=1);

namespace luminx\craft\Apply;

use Craft;

/**
 * Writes through Craft's service API, straight to the database. The development path, and the
 * only one implemented (§11.2).
 *
 * It cannot write when `allowAdminChanges` is off — the normal production state — and says so,
 * so the CLI can point at deploy rather than let a generator fail mid-apply. This is the check
 * the Applier used to make inline; it lives here now, behind the seam, where its production
 * sibling will sit beside it.
 */
final readonly class ServiceApiWriteStrategy implements WriteStrategy
{
    public function canWrite(): bool
    {
        return Craft::$app->getConfig()->getGeneral()->allowAdminChanges;
    }

    public function reason(): ?string
    {
        return $this->canWrite()
            ? null
            : 'allowAdminChanges is off. This is normal on production; deploy the project config '
                . 'instead (docs/deploy.md).';
    }

    public function flush(): void
    {
        Craft::$app->getProjectConfig()->saveModifiedConfigData();
    }
}
