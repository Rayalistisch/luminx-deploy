<?php

declare(strict_types=1);

namespace luminx\craft\Protocol;

/**
 * The response envelope (docs/architecture.md §7.4).
 *
 * An envelope either carries data or carries at least one error. The named constructors make
 * the `ok: true` with errors state unreachable, rather than merely discouraged — the TypeScript
 * side models the same thing as a union.
 *
 * The process exit code reports transport failure. Domain failure lives in `errors`, on an
 * envelope that arrived intact. Confusing the two is how a tool ends up retrying a validation
 * error.
 */
final readonly class Envelope
{
    public const int PROTOCOL_VERSION = 1;

    /**
     * @param list<array{code: string, message: string, hint?: string}> $errors
     * @param list<string> $warnings
     * @param array<string, string> $diagnostics
     */
    private function __construct(
        public bool $ok,
        public mixed $data,
        public array $errors,
        public array $warnings,
        public array $diagnostics,
    ) {
    }

    /**
     * @param list<string> $warnings
     * @param array<string, string> $diagnostics
     */
    public static function success(mixed $data, array $diagnostics = [], array $warnings = []): self
    {
        return new self(true, $data, [], $warnings, $diagnostics);
    }

    /**
     * @param non-empty-list<array{code: string, message: string, hint?: string}> $errors
     * @param array<string, string> $diagnostics
     */
    public static function failure(array $errors, array $diagnostics = []): self
    {
        return new self(false, null, $errors, [], $diagnostics);
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        $body = [
            'protocolVersion' => self::PROTOCOL_VERSION,
            'ok' => $this->ok,
            'errors' => $this->errors,
            'warnings' => $this->warnings,
            'diagnostics' => $this->diagnostics,
        ];

        // A failed envelope has no `data` at all, so no caller can read a half-built value.
        if ($this->ok) {
            $body['data'] = $this->data;
        }

        return $body;
    }
}
