<?php

declare(strict_types=1);

namespace luminx\craft\Introspect\Data;

final readonly class FieldData
{
    /**
     * @param array<string, mixed> $settings Craft's own field settings, verbatim.
     * @param list<string> $sources Handles of the resources a relation field points at.
     * @param list<string> $entryTypeHandles Entry types nested in a matrix field.
     */
    public function __construct(
        public string $uid,
        public string $handle,
        public string $name,
        /** Fully qualified Craft field class. The resolver turns it into an IR field type. */
        public string $class,
        public array $settings = [],
        public array $sources = [],
        public array $entryTypeHandles = [],
    ) {
    }
}
