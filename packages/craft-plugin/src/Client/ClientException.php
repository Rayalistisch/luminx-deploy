<?php

declare(strict_types=1);

namespace luminx\craft\Client;

use RuntimeException;

/** A read side that could not be opened. Same envelope and codes as the rest of the protocol. */
final class ClientException extends RuntimeException
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
