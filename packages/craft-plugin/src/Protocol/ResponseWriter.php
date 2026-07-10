<?php

declare(strict_types=1);

namespace luminx\craft\Protocol;

use JsonException;

/**
 * Writes the response where the CLI will look for it (§7.4).
 *
 * The write is atomic: a temporary file in the same directory, then a rename. A crash halfway
 * through must leave no half-written response for the CLI to parse — that is the one failure
 * mode file transport has that a pipe does not.
 */
final readonly class ResponseWriter
{
    public function write(string $path, Envelope $envelope): void
    {
        try {
            $json = json_encode(
                $envelope->toArray(),
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
            );
        } catch (JsonException $exception) {
            throw ProtocolException::transportFailure(
                'Cannot encode the response: ' . $exception->getMessage(),
            );
        }

        $directory = dirname($path);

        if (!is_dir($directory) && !@mkdir($directory, 0o775, true) && !is_dir($directory)) {
            throw ProtocolException::transportFailure(sprintf('Cannot create %s', $directory));
        }

        // Same directory as the target, so the rename stays on one filesystem and is atomic.
        $temporary = $path . '.' . bin2hex(random_bytes(6)) . '.tmp';

        if (@file_put_contents($temporary, $json) === false) {
            throw ProtocolException::transportFailure(sprintf('Cannot write %s', $temporary));
        }

        if (!@rename($temporary, $path)) {
            @unlink($temporary);
            throw ProtocolException::transportFailure(sprintf('Cannot move the response to %s', $path));
        }
    }
}
