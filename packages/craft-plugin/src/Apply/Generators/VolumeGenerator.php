<?php

declare(strict_types=1);

namespace luminx\craft\Apply\Generators;

use Craft;
use craft\elements\Asset;
use craft\models\FieldLayout;
use craft\models\Volume;
use luminx\craft\Apply\ApplyContext;
use luminx\craft\Apply\ApplyException;
use luminx\craft\Apply\Generator;

final readonly class VolumeGenerator implements Generator
{
    public function kind(): string
    {
        return 'volume';
    }

    public function apply(array $resource, ApplyContext $context): string
    {
        $handle = (string) $resource['handle'];
        $spec = (array) $resource['spec'];

        $volume = Craft::$app->getVolumes()->getVolumeByHandle($handle) ?? new Volume();
        $volume->handle = $handle;
        $volume->name = (string) $resource['name'];
        $volume->setFsHandle(ApplyContext::handleOf((string) $spec['fs']));

        if (isset($spec['subpath'])) {
            $volume->subpath = (string) $spec['subpath'];
        }

        if ($volume->getFieldLayout() === null) {
            $volume->setFieldLayout(new FieldLayout(['type' => Asset::class]));
        }

        if (!Craft::$app->getVolumes()->saveVolume($volume)) {
            throw ApplyException::invalid($resource['logicalId'], $volume->getErrors());
        }

        return (string) $volume->uid;
    }

    public function delete(array $resource, string $uid): void
    {
        $volume = Craft::$app->getVolumes()->getVolumeByHandle((string) $resource['handle']);

        if ($volume !== null) {
            Craft::$app->getVolumes()->deleteVolume($volume);
        }
    }
}
