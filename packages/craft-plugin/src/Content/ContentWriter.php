<?php

declare(strict_types=1);

namespace luminx\craft\Content;

use Craft;
use craft\elements\Entry;
use craft\helpers\ArrayHelper;
use craft\models\EntryType;
use craft\models\Section;
use DateTime;
use DateTimeZone;
use Throwable;

/**
 * Writes entries — the content, not the model.
 *
 * Everything else in this plugin edits Craft's *project config*: sections, fields, entry types. That
 * is a file, it is deterministic, and `luminx generate` reconciles it — what the config does not
 * describe, `--prune` deletes. This class is the one place that touches the database, and the rules
 * are deliberately not the same.
 *
 * **It never deletes.** A content model is authored; content is *written*, by people, and often
 * after it was pushed. A markdown file deleted from a repository must not take a published article
 * with it — nor the edits an editor made to it in the control panel that morning. Reconciliation is
 * right for a schema and catastrophic for prose. So this upserts and stops there; removing an entry
 * is a decision a human makes in Craft.
 *
 * Matching is by slug within the section, because a slug is the one identifier a markdown file and
 * a CMS entry both already have. Push the same file twice and the same entry is updated twice.
 */
final class ContentWriter
{
    /**
     * @param list<array<string, mixed>> $entries
     * @return array<string, mixed>
     * @throws ContentException
     */
    public function write(array $entries): array
    {
        $results = [];

        foreach ($entries as $data) {
            $results[] = $this->upsert($data);
        }

        return [
            'written' => $results,
            'created' => count(array_filter($results, static fn(array $r): bool => $r['status'] === 'created')),
            'updated' => count(array_filter($results, static fn(array $r): bool => $r['status'] === 'updated')),
        ];
    }

    /**
     * @param array<string, mixed> $data
     * @return array{slug: string, status: string, id: int}
     * @throws ContentException
     */
    private function upsert(array $data): array
    {
        $sectionHandle = (string) ($data['section'] ?? '');
        $typeHandle = (string) ($data['entryType'] ?? '');
        $slug = (string) ($data['slug'] ?? '');

        if ($sectionHandle === '' || $typeHandle === '' || $slug === '') {
            throw new ContentException('LX4001', 'An entry needs a section, an entry type and a slug.');
        }

        $section = $this->section($sectionHandle);
        $type = $this->entryType($section, $typeHandle);

        // The upsert: an entry with this slug, in this section, or a new one.
        $entry = Entry::find()
            ->sectionId($section->id)
            ->slug($slug)
            ->status(null)
            ->one();

        $status = $entry === null ? 'created' : 'updated';

        if ($entry === null) {
            $entry = new Entry();
            $entry->sectionId = $section->id;
            $entry->slug = $slug;
        }

        $entry->typeId = $type->id;

        if (isset($data['title'])) {
            $entry->title = (string) $data['title'];
        }

        // The entry's own author, which is a Craft user — not the `author` string in a frontmatter,
        // which is a name and has been imported as an ordinary field.
        $entry->authorId ??= $this->firstAdminId();

        if (isset($data['postDate']) && is_string($data['postDate'])) {
            $postDate = $this->date($data['postDate']);
            if ($postDate !== null) {
                $entry->postDate = $postDate;
            }
        }

        /** @var array<string, mixed> $fields */
        $fields = (array) ($data['fields'] ?? []);
        $entry->setFieldValues($this->fieldValues($type, $fields));

        if (!Craft::$app->getElements()->saveElement($entry)) {
            throw new ContentException(
                'LX4001',
                sprintf('Craft rejected the entry "%s".', $slug),
                $this->errorsOf($entry),
            );
        }

        return ['slug' => $slug, 'status' => $status, 'id' => (int) $entry->id];
    }

    /**
     * Field values, with matrix fields turned into the shape Craft's Matrix field expects.
     *
     * A matrix value is not a list of maps — it is a map keyed by block id, each block naming its
     * entry type and carrying its own fields (`craft\fields\Matrix::_createEntriesFromSerializedData`).
     * `new1`, `new2`… are the keys Craft itself uses for blocks that do not exist yet.
     *
     * @param array<string, mixed> $fields
     * @return array<string, mixed>
     */
    private function fieldValues(EntryType $type, array $fields): array
    {
        $layoutFields = ArrayHelper::index($type->getFieldLayout()?->getCustomFields() ?? [], 'handle');
        $values = [];

        foreach ($fields as $handle => $value) {
            $field = $layoutFields[$handle] ?? null;

            if ($field instanceof \craft\fields\Matrix && is_array($value)) {
                $blocks = [];
                foreach (array_values($value) as $index => $block) {
                    if (!is_array($block)) {
                        continue;
                    }
                    $blocks['new' . ($index + 1)] = [
                        'type' => (string) ($block['entryType'] ?? ''),
                        'fields' => (array) ($block['fields'] ?? []),
                    ];
                }
                $values[$handle] = $blocks;
                continue;
            }

            $values[$handle] = $value;
        }

        return $values;
    }

    /** @throws ContentException */
    private function section(string $handle): Section
    {
        $section = Craft::$app->getEntries()->getSectionByHandle($handle);

        if ($section === null) {
            throw new ContentException(
                'LX4001',
                sprintf('No section "%s" in Craft.', $handle),
                ['Run `luminx generate` first, so the model exists before the content does.']
            );
        }

        return $section;
    }

    /** @throws ContentException */
    private function entryType(Section $section, string $handle): EntryType
    {
        foreach ($section->getEntryTypes() as $type) {
            if ($type->handle === $handle) {
                return $type;
            }
        }

        throw new ContentException(
            'LX4001',
            sprintf('Section "%s" has no entry type "%s".', $section->handle, $handle)
        );
    }

    /**
     * An entry needs an author, and a push has no user to speak for it. The first admin is the
     * honest choice: it is who owns the CMS, and it is visible in the control panel.
     */
    private function firstAdminId(): ?int
    {
        $admin = \craft\elements\User::find()->admin()->orderBy(['id' => SORT_ASC])->one();

        return $admin?->id === null ? null : (int) $admin->id;
    }

    private function date(string $value): ?DateTime
    {
        try {
            return new DateTime($value, new DateTimeZone('UTC'));
        } catch (Throwable) {
            return null;
        }
    }

    /** @return list<string> */
    private function errorsOf(Entry $entry): array
    {
        $messages = [];

        foreach ($entry->getErrors() as $attribute => $errors) {
            foreach ((array) $errors as $error) {
                $messages[] = sprintf('%s: %s', $attribute, (string) $error);
            }
        }

        return $messages;
    }
}
