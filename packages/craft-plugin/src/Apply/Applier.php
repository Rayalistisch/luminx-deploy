<?php

declare(strict_types=1);

namespace luminx\craft\Apply;

use Craft;
use Throwable;
use yii\db\Exception as DbException;

/**
 * Executes the operations the core decided on (§7.2, §9.5).
 *
 * One transaction per operation, and no transaction around the run: Craft's project config is not
 * globally transactional, and pretending otherwise would be worse than saying so. Operation *n*
 * rolls back on failure; operations before it stay applied. The response carries what ran, the
 * CLI exits 4, and `luminx undo` restores the snapshot taken before any of it.
 */
final readonly class Applier
{
    public function __construct(
        private GeneratorRegistry $registry = new GeneratorRegistry(),
        private WriteStrategy $writeStrategy = new ServiceApiWriteStrategy(),
    ) {
    }

    /**
     * @param list<array<string, mixed>> $operations
     * @param array<string, string> $resolved logicalId → UID, from earlier operations
     * @return array{results: list<array<string, mixed>>, resolved: array<string, string>}
     */
    public function apply(array $operations, array $resolved = []): array
    {
        // The write strategy decides whether this state can be written at all (§11.2). Today only
        // the service-API path exists, and it refuses when allowAdminChanges is off.
        if (!$this->writeStrategy->canWrite()) {
            throw ApplyException::adminChangesDisabled();
        }

        $results = [];

        foreach ($operations as $operation) {
            $resource = (array) $operation['resource'];
            $logicalId = (string) $resource['logicalId'];
            $kind = (string) $operation['kind'];

            if ($kind === 'skip') {
                $results[] = $this->result($logicalId, $resolved[$logicalId] ?? '', 'skipped');
                continue;
            }

            $generator = $this->registry->get((string) $resource['kind']);
            $context = new ApplyContext($resolved, (int) ($operation['phase'] ?? 1));

            $uid = $this->transactional(
                $logicalId,
                fn (): string => match ($kind) {
                    'delete' => $this->deleted($generator, $resource, (string) $operation['uid']),
                    default => $generator->apply($resource, $context),
                },
            );

            $resolved[$logicalId] = $uid;
            $results[] = $this->result($logicalId, $uid, $this->statusOf($kind));
        }

        // Craft writes project config asynchronously; the strategy forces the flush so the
        // response describes a CMS that has actually changed, not one that is about to (§9.5).
        $this->writeStrategy->flush();

        return ['results' => $results, 'resolved' => $resolved];
    }

    /** @param array<string, mixed> $resource */
    private function deleted(Generator $generator, array $resource, string $uid): string
    {
        $generator->delete($resource, $uid);

        return $uid;
    }

    /** @param callable(): string $work */
    private function transactional(string $logicalId, callable $work): string
    {
        $transaction = Craft::$app->getDb()->beginTransaction();

        try {
            $uid = $work();
            $transaction?->commit();

            return $uid;
        } catch (ApplyException $exception) {
            $transaction?->rollBack();
            throw $exception;
        } catch (DbException | Throwable $exception) {
            $transaction?->rollBack();
            throw ApplyException::failed($logicalId, $exception->getMessage());
        }
    }

    private function statusOf(string $kind): string
    {
        return match ($kind) {
            'create' => 'created',
            'update' => 'updated',
            'delete' => 'deleted',
            default => 'skipped',
        };
    }

    /** @return array<string, mixed> */
    private function result(string $logicalId, string $uid, string $status): array
    {
        return ['logicalId' => $logicalId, 'uid' => $uid, 'status' => $status, 'warnings' => []];
    }
}
