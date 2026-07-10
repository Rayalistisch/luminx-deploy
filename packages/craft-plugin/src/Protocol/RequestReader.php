<?php

declare(strict_types=1);

namespace luminx\craft\Protocol;

use JsonException;
use stdClass;

/**
 * Reads a request written by the CLI (§7.4).
 *
 * The protocol version is checked before anything else is trusted. There is no implicit
 * compatibility: a wire format that silently half-works is worse than one that stops.
 */
final readonly class RequestReader
{
    /**
     * @param float $waitSeconds How long to wait for the request to appear.
     *
     * The CLI runs on the host and writes the request there; PHP reads it through a mounted
     * volume. On macOS, DDEV syncs that mount with Mutagen, and the propagation is asynchronous —
     * measured at one to six seconds. Reading immediately would report a missing request for a
     * file the CLI had already written.
     */
    public function __construct(private float $waitSeconds = 10.0)
    {
    }

    /** @return array<string, mixed> */
    public function read(string $path): array
    {
        $this->waitFor($path);

        // Asked, not suppressed: `@file_get_contents` still raises the warning, and a test runner
        // that turns warnings into failures will fail on the very case this handles.
        if (!is_file($path) || !is_readable($path)) {
            throw ProtocolException::malformedRequest($path, 'no such file, or it is unreadable');
        }

        $text = file_get_contents($path);

        if ($text === false) {
            throw ProtocolException::transportFailure(sprintf('Cannot read %s', $path));
        }

        try {
            // Decoded as an object first: with `assoc: true`, `{}` and `[]` both become the empty
            // array, and `array_is_list([])` is true. An empty request would be rejected as though
            // it were a JSON array, and the user would be told the wrong thing.
            /** @var mixed $object */
            $object = json_decode($text, false, 64, JSON_THROW_ON_ERROR);

            /** @var mixed $decoded */
            $decoded = json_decode($text, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            throw ProtocolException::malformedRequest($path, $exception->getMessage());
        }

        if (!$object instanceof stdClass || !is_array($decoded)) {
            throw ProtocolException::malformedRequest($path, 'expected a JSON object');
        }

        $version = $decoded['protocolVersion'] ?? null;

        if (!is_int($version)) {
            throw ProtocolException::malformedRequest($path, 'protocolVersion is missing');
        }

        if ($version !== Envelope::PROTOCOL_VERSION) {
            throw ProtocolException::versionMismatch($version, Envelope::PROTOCOL_VERSION);
        }

        return $decoded;
    }

    /** Polls until the file appears, or the wait runs out. Absent is still absent afterwards. */
    private function waitFor(string $path): void
    {
        $deadline = microtime(true) + $this->waitSeconds;

        while (microtime(true) < $deadline) {
            clearstatcache(true, $path);

            if (is_file($path)) {
                return;
            }

            usleep(50_000);
        }
    }
}
