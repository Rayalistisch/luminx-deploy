<?php

declare(strict_types=1);

namespace luminx\craft\Introspect\Data;

/**
 * Plain, readonly facts about what the CMS holds.
 *
 * These exist because Craft's own models cannot be built without a booted application: `new
 * Section(...)` reaches for `Craft::`, `new EntryType(...)` for `Yii::`. Normalising straight
 * from those models would make every mapping in this package untestable without a database.
 *
 * The gateway does the reaching, these carry the answer, and the Introspector — the part with
 * the decisions in it — is a pure function over them.
 *
 * Handles, never UIDs or source keys. Resolving `volume:3f2b…` back to `images` is Craft-shaped
 * work and belongs on the gateway's side of this line.
 */
final readonly class FilesystemData
{
    public function __construct(
        public string $uid,
        public string $handle,
        public string $name,
        /** The filesystem type, as a class name or short id. Opaque to the IR. */
        public string $type,
        public string $path,
        public ?string $url = null,
    ) {
    }
}
