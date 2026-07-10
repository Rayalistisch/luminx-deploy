<?php

declare(strict_types=1);

namespace luminx\craft\Introspect;

use luminx\craft\Introspect\Data\FieldLayoutEntryData;

/**
 * Turns what the CMS holds into the CMS-neutral IR (§6).
 *
 * Free of side effects, and free of Craft: it reads a Gateway. That is what lets every mapping
 * below be tested without a database, and it is why M6 can be finished before M7 exists.
 *
 * No hashes are computed here. The TypeScript adapter hashes the spec with the same canonical
 * JSON the compiler uses, so both sides of a diff are hashed by one implementation. A second
 * canonical serialiser in PHP would be a second chance to disagree, and a disagreement means
 * every resource looks changed on every run.
 */
final readonly class Introspector
{
    public function __construct(private FieldTypeResolver $resolver = new FieldTypeResolver())
    {
    }

    /**
     * @param list<string>|null $kinds Restricts the read, as `--only sections,fields` does.
     * @return list<array<string, mixed>>
     */
    public function introspect(Gateway $gateway, ?array $kinds = null): array
    {
        $wanted = static fn (string $kind): bool => $kinds === null || in_array($kind, $kinds, true);
        $resources = [];

        if ($wanted('filesystem')) {
            foreach ($gateway->filesystems() as $fs) {
                $resources[] = $this->resource('filesystem', $fs->handle, $fs->name, $fs->uid, array_filter([
                    'type' => $fs->type,
                    'path' => $fs->path,
                    'url' => $fs->url,
                ], static fn (mixed $value): bool => $value !== null));
            }
        }

        if ($wanted('volume')) {
            foreach ($gateway->volumes() as $volume) {
                $spec = array_filter(
                    ['fs' => 'filesystem:' . $volume->fsHandle, 'subpath' => $volume->subpath],
                    static fn (mixed $value): bool => $value !== null,
                );

                // A volume cannot exist before the filesystem it writes to. Not wiring: ordering.
                $resources[] = $this->resource('volume', $volume->handle, $volume->name, $volume->uid, $spec, [
                    'filesystem:' . $volume->fsHandle,
                ]);
            }
        }

        if ($wanted('field')) {
            foreach ($gateway->fields() as $field) {
                $resources[] = $this->resource(
                    'field',
                    $field->handle,
                    $field->name,
                    $field->uid,
                    $this->resolver->resolve($field),
                );
            }
        }

        if ($wanted('entryType')) {
            foreach ($gateway->entryTypes() as $entryType) {
                $layout = $this->layout($entryType->fields);

                $resources[] = $this->resource(
                    'entryType',
                    $entryType->handle,
                    $entryType->name,
                    $entryType->uid,
                    ['fields' => $layout],
                    array_column($layout, 'field'),
                );
            }
        }

        if ($wanted('section')) {
            foreach ($gateway->sections() as $section) {
                $entryTypes = array_map(
                    static fn (string $handle): string => 'entryType:' . $handle,
                    $section->entryTypeHandles,
                );

                $spec = array_filter([
                    'type' => $section->type,
                    'entryTypes' => $entryTypes,
                    'maxLevels' => $section->maxLevels,
                    'uriFormat' => $section->uriFormat,
                    'template' => $section->template,
                ], static fn (mixed $value): bool => $value !== null);

                $resources[] = $this->resource(
                    'section',
                    $section->handle,
                    $section->name,
                    $section->uid,
                    $spec,
                    $entryTypes,
                );
            }
        }

        if ($wanted('category')) {
            foreach ($gateway->categories() as $category) {
                $spec = array_filter([
                    'maxLevels' => $category->maxLevels,
                    'uriFormat' => $category->uriFormat,
                    'template' => $category->template,
                ], static fn (mixed $value): bool => $value !== null);

                $resources[] = $this->resource('category', $category->handle, $category->name, $category->uid, $spec);
            }
        }

        if ($wanted('globalSet')) {
            foreach ($gateway->globalSets() as $globalSet) {
                $layout = $this->layout($globalSet->fields);

                $resources[] = $this->resource(
                    'globalSet',
                    $globalSet->handle,
                    $globalSet->name,
                    $globalSet->uid,
                    ['fields' => $layout],
                    array_column($layout, 'field'),
                );
            }
        }

        if ($wanted('userGroup')) {
            foreach ($gateway->userGroups() as $group) {
                $permissions = $group->permissions;
                sort($permissions);

                $resources[] = $this->resource(
                    'userGroup',
                    $group->handle,
                    $group->name,
                    $group->uid,
                    ['permissions' => array_values($permissions)],
                );
            }
        }

        // The order Craft happens to return things in is not a property of the model.
        usort(
            $resources,
            static fn (array $a, array $b): int => strcmp((string) $a['logicalId'], (string) $b['logicalId']),
        );

        return $resources;
    }

    /**
     * @param list<FieldLayoutEntryData> $entries
     * @return list<array{field: string, required: bool, tab?: string}>
     */
    private function layout(array $entries): array
    {
        return array_map(static function (FieldLayoutEntryData $entry): array {
            $mapped = ['field' => 'field:' . $entry->fieldHandle, 'required' => $entry->required];

            if ($entry->tab !== null) {
                $mapped['tab'] = $entry->tab;
            }

            return $mapped;
        }, $entries);
    }

    /**
     * @param array<string, mixed> $spec
     * @param list<string> $dependsOn
     * @return array<string, mixed>
     */
    private function resource(
        string $kind,
        string $handle,
        string $name,
        string $uid,
        array $spec,
        array $dependsOn = [],
    ): array {
        return [
            'kind' => $kind,
            'logicalId' => $kind . ':' . $handle,
            'handle' => $handle,
            'name' => $name,
            'spec' => $spec,
            'dependsOn' => array_values($dependsOn),
            'uid' => $uid,
        ];
    }
}
