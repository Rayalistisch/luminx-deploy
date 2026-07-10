<?php

declare(strict_types=1);

namespace luminx\craft\Protocol;

use RuntimeException;

/**
 * A failure the CLI can name. The codes are the same closed set the TypeScript side uses
 * (`@luminx/shared`, §3.1): a user greps for `LX3001` and finds one meaning, on either side of
 * the wire.
 */
final class ProtocolException extends RuntimeException
{
    /**
     * Not `$code`: `Exception` already has one, and it is an int. Shadowing it with a readonly
     * string is a fatal error, and widening ours to an int would throw away the very thing that
     * makes an error greppable.
     */
    private function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly ?string $hint = null,
    ) {
        parent::__construct($message);
    }

    public static function versionMismatch(int $theirs, int $ours): self
    {
        return new self(
            'LX3001',
            sprintf('The CLI speaks protocol v%d; this plugin speaks v%d.', $theirs, $ours),
            $theirs > $ours
                ? 'Update the plugin: composer update luminx/craft-luminx'
                : 'Update the CLI: npm install luminx@latest',
        );
    }

    public static function malformedRequest(string $path, string $why): self
    {
        return new self('LX3002', sprintf('Cannot read the request at %s: %s', $path, $why));
    }

    public static function transportFailure(string $why): self
    {
        return new self('LX3003', $why);
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
