<?php

declare(strict_types=1);

namespace luminx\craft\Apply\Generators;

use Craft;
use craft\fs\Local;
use luminx\craft\Apply\ApplyContext;
use luminx\craft\Apply\ApplyException;
use luminx\craft\Apply\Generator;

/**
 * Craft's filesystems carry no UID; the handle is their identity, and the introspector reports it
 * as such. Anything else would put an empty string in the lockfile.
 */
final readonly class FilesystemGenerator implements Generator
{
    public function kind(): string
    {
        return 'filesystem';
    }

    public function apply(array $resource, ApplyContext $context): string
    {
        $handle = (string) $resource['handle'];
        $spec = (array) $resource['spec'];

        $fs = Craft::$app->getFs()->getFilesystemByHandle($handle) ?? new Local();
        $fs->handle = $handle;
        $fs->name = (string) $resource['name'];
        $fs->path = (string) ($spec['path'] ?? '');

        if (isset($spec['url'])) {
            $fs->hasUrls = true;
            $fs->url = (string) $spec['url'];
        }

        if (!Craft::$app->getFs()->saveFilesystem($fs)) {
            throw ApplyException::invalid($resource['logicalId'], $fs->getErrors());
        }

        return $handle;
    }

    public function delete(array $resource, string $uid): void
    {
        $fs = Craft::$app->getFs()->getFilesystemByHandle((string) $resource['handle']);

        if ($fs !== null) {
            Craft::$app->getFs()->removeFilesystem($fs);
        }
    }
}
