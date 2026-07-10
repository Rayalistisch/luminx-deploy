<?php

declare(strict_types=1);

namespace luminx\craft\Apply;

use RuntimeException;

/** A write that failed. The CLI turns `LX4001` into exit 4 and points at `luminx undo`. */
final class ApplyException extends RuntimeException
{
    private function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly ?string $hint = null,
    ) {
        parent::__construct($message);
    }

    /** @param array<string, list<string>> $errors */
    public static function invalid(string $logicalId, array $errors): self
    {
        $flat = [];

        foreach ($errors as $attribute => $messages) {
            foreach ($messages as $message) {
                $flat[] = sprintf('%s: %s', $attribute, $message);
            }
        }

        return new self('LX4001', sprintf('%s was rejected by Craft', $logicalId), implode('; ', $flat));
    }

    public static function failed(string $logicalId, string $why): self
    {
        return new self('LX4001', sprintf('%s could not be saved: %s', $logicalId, $why));
    }

    public static function adminChangesDisabled(): self
    {
        return new self(
            'LX2005',
            'Craft refuses writes to project config: allowAdminChanges is off',
            'This is normal on production. Deploy the project config instead; see docs/architecture.md §11.',
        );
    }

    public static function snapshotFailed(string $why): self
    {
        return new self('LX4002', 'Could not take a snapshot: ' . $why);
    }

    public static function restoreFailed(string $why): self
    {
        return new self('LX4003', 'Could not restore the snapshot: ' . $why);
    }

    /** @return array{code: string, message: string, hint?: string} */
    public function toArray(): array
    {
        $error = ['code' => $this->errorCode, 'message' => $this->getMessage()];

        if ($this->hint !== null) {
            $error['hint'] = $this->hint;
        }

        return $error;
    }
}
