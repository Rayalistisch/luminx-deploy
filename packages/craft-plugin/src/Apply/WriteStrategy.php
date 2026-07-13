<?php

declare(strict_types=1);

namespace luminx\craft\Apply;

/**
 * How an applied change reaches Craft (docs/architecture.md §11.2).
 *
 * There are two ways, and they matter for deploy. In development, `allowAdminChanges` is on and
 * the service API writes straight to the database — fast, and what every generator does today.
 * On production it is off by default (§9.3): Craft refuses service-API writes to project config,
 * and the only way in is to write `config/project/*.yaml` and run `project-config/apply`.
 *
 * This interface is the seam between those two. Only `ServiceApiWriteStrategy` exists now, and it
 * is what the Applier already did, named. `ProjectConfigWriteStrategy` — the read-only-safe path
 * deploy needs — is reserved here so that adding it later touches this file and not a single
 * generator. Reserving the shape now is the whole of M12: deploy is architecture, not code (§14).
 */
interface WriteStrategy
{
    /** Can this strategy write in the project's current state? */
    public function canWrite(): bool;

    /** Why not, when `canWrite()` is false — a message the CLI can show. */
    public function reason(): ?string;

    /**
     * Flush anything Craft deferred, so the response describes a CMS that has actually changed
     * rather than one that is about to. Craft writes project config asynchronously (§9.5).
     */
    public function flush(): void;
}
