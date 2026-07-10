<?php

declare(strict_types=1);

namespace luminx\craft\Apply\Generators;

use Craft;
use craft\models\UserGroup;
use luminx\craft\Apply\ApplyContext;
use luminx\craft\Apply\ApplyException;
use luminx\craft\Apply\Generator;

final readonly class UserGroupGenerator implements Generator
{
    public function kind(): string
    {
        return 'userGroup';
    }

    public function apply(array $resource, ApplyContext $context): string
    {
        $handle = (string) $resource['handle'];
        $spec = (array) $resource['spec'];

        $group = Craft::$app->getUserGroups()->getGroupByHandle($handle) ?? new UserGroup();
        $group->handle = $handle;
        $group->name = (string) $resource['name'];

        if (!Craft::$app->getUserGroups()->saveGroup($group)) {
            throw ApplyException::invalid($resource['logicalId'], $group->getErrors());
        }

        /** @var list<string> $permissions */
        $permissions = (array) ($spec['permissions'] ?? []);
        Craft::$app->getUserPermissions()->saveGroupPermissions((int) $group->id, $permissions);

        return (string) $group->uid;
    }

    public function delete(array $resource, string $uid): void
    {
        $group = Craft::$app->getUserGroups()->getGroupByHandle((string) $resource['handle']);

        if ($group !== null) {
            Craft::$app->getUserGroups()->deleteGroupById((int) $group->id);
        }
    }
}
