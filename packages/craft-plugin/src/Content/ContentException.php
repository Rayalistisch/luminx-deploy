<?php

declare(strict_types=1);

namespace luminx\craft\Content;

use RuntimeException;

/** A content write that failed. Same envelope, same codes as an apply — the CLI needs no new cases. */
final class ContentException extends RuntimeException
{
    /** @param list<string> $details */
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }

    /** @return array{code: string, message: string, hint?: string} */
    public function toArray(): array
    {
        $error = ['code' => $this->errorCode, 'message' => $this->getMessage()];

        if ($this->details !== []) {
            $error['hint'] = implode('; ', $this->details);
        }

        return $error;
    }
}
