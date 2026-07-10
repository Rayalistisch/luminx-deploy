<?php

declare(strict_types=1);

namespace luminx\craft\Apply;

use Craft;
use DateTimeImmutable;
use DateTimeZone;

/**
 * Snapshots of the project config (§10).
 *
 * The **whole** project config, not the subtrees LuminX writes. §10 argues for subtrees on the
 * grounds that a delete cannot be undone from a diff of touched paths — true, and not far enough.
 *
 * Restoring subtree by subtree does not work. Craft applies each `set()` on its own, so putting
 * `fields` back to null while `entryTypes` still reference those fields is a deletion Craft
 * quietly declines. Measured against a real install: `fs`, `volumes` and `userGroups` reverted;
 * `fields`, `entryTypes`, `sections` and `categoryGroups` survived, and `undo` reported success
 * over a CMS it had barely touched.
 *
 * `applyConfigChanges()` takes a complete config, works out what is new, changed and removed, and
 * applies it in Craft's own dependency order. Which is the only order that is right.
 *
 * Its limit, stated plainly: this restores the *content model*, never the *content*. Delete a
 * section and its entries are gone; `undo` brings the section back, empty. That is why `delete`
 * is off by default (§8.2).
 */
final readonly class SnapshotService
{
    /**
     * The snapshot format, and it is part of the contract.
     *
     * Version 1 stored eight subtrees. Restoring one of those with the version-2 code — which
     * hands Craft a complete config and lets it work out what is missing — told Craft that
     * `plugins` and `sites` had been removed, and it dutifully uninstalled the plugin doing the
     * restoring. A snapshot in a format this code does not understand is refused, not guessed at.
     */
    private const int FORMAT = 2;

    private const int KEEP = 10;

    public function directory(): string
    {
        return Craft::$app->getPath()->getStoragePath() . '/luminx/snapshots';
    }

    /** @return array{id: string, createdAt: string, planHash: string} */
    public function create(string $planHash = ''): array
    {
        $createdAt = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $id = $createdAt->format('Y-m-d\THis\Z') . '-' . bin2hex(random_bytes(3));
        $path = $this->directory() . '/' . $id;

        if (!is_dir($path) && !@mkdir($path, 0o775, true) && !is_dir($path)) {
            throw ApplyException::snapshotFailed('cannot create ' . $path);
        }

        $config = Craft::$app->getProjectConfig()->get();

        if (!is_array($config)) {
            throw ApplyException::snapshotFailed('the project config is empty or unreadable');
        }

        $manifest = [
            'id' => $id,
            'format' => self::FORMAT,
            'createdAt' => $createdAt->format(DATE_ATOM),
            'planHash' => $planHash,
            'craftVersion' => Craft::$app->getVersion(),
            'protocolVersion' => 1,
        ];

        $this->write($path . '/manifest.json', $manifest);
        $this->write($path . '/projectConfig.json', $config);

        $this->prune();

        return ['id' => $id, 'createdAt' => $manifest['createdAt'], 'planHash' => $planHash];
    }

    public function restore(string $id): void
    {
        $path = $this->directory() . '/' . $id . '/projectConfig.json';

        if (!is_file($path)) {
            throw ApplyException::restoreFailed('no snapshot ' . $id);
        }

        $this->assertFormat($id);

        /** @var array<string, mixed>|null $config */
        $config = json_decode((string) file_get_contents($path), true);

        if (!is_array($config)) {
            throw ApplyException::restoreFailed('snapshot ' . $id . ' is corrupt');
        }

        // Craft computes the diff and applies it in dependency order. Setting the subtrees one by
        // one deletes a field an entry type still uses, and Craft declines without a word.
        Craft::$app->getProjectConfig()->applyConfigChanges($config);
    }

    /**
     * A snapshot written by another version of this plugin is not a snapshot this one can apply.
     * Refusing costs the user a manual fix; guessing cost us the plugin itself.
     */
    private function assertFormat(string $id): void
    {
        $manifestPath = $this->directory() . '/' . $id . '/manifest.json';

        /** @var array{format?: int}|null $manifest */
        $manifest = is_file($manifestPath)
            ? json_decode((string) file_get_contents($manifestPath), true)
            : null;

        $format = is_array($manifest) ? ($manifest['format'] ?? 1) : 1;

        if ($format !== self::FORMAT) {
            throw ApplyException::restoreFailed(sprintf(
                'snapshot %s is in format v%d; this plugin restores v%d. Delete it, or use the plugin version that wrote it.',
                $id,
                $format,
                self::FORMAT,
            ));
        }
    }

    /** @return list<array{id: string, createdAt: string, planHash: string}> */
    public function list(): array
    {
        $entries = @scandir($this->directory());

        if ($entries === false) {
            return [];
        }

        $snapshots = [];

        foreach ($entries as $entry) {
            $manifest = $this->directory() . '/' . $entry . '/manifest.json';

            if ($entry === '.' || $entry === '..' || !is_file($manifest)) {
                continue;
            }

            /** @var array{id?: string, createdAt?: string, planHash?: string}|null $decoded */
            $decoded = json_decode((string) file_get_contents($manifest), true);

            $snapshots[] = [
                'id' => (string) ($decoded['id'] ?? $entry),
                'createdAt' => (string) ($decoded['createdAt'] ?? ''),
                'planHash' => (string) ($decoded['planHash'] ?? ''),
            ];
        }

        // Newest first: `undo` with no id means the last one.
        usort($snapshots, static fn (array $a, array $b): int => strcmp($b['id'], $a['id']));

        return $snapshots;
    }

    private function prune(): void
    {
        foreach (array_slice($this->list(), self::KEEP) as $old) {
            $path = $this->directory() . '/' . $old['id'];

            foreach ((array) @scandir($path) as $file) {
                if ($file !== '.' && $file !== '..') {
                    @unlink($path . '/' . $file);
                }
            }
            @rmdir($path);
        }
    }

    private function write(string $path, mixed $value): void
    {
        $json = json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        if ($json === false || @file_put_contents($path, $json) === false) {
            throw ApplyException::snapshotFailed('cannot write ' . $path);
        }
    }
}
