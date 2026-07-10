<?php

declare(strict_types=1);

namespace luminx\craft\console\controllers;

use Craft;
use craft\console\Controller;
use luminx\craft\Apply\ApplyException;
use luminx\craft\Apply\SnapshotService;
use luminx\craft\Protocol\Envelope;
use luminx\craft\Protocol\ProtocolException;
use luminx\craft\Protocol\RequestReader;
use luminx\craft\Protocol\ResponseWriter;
use Throwable;
use yii\console\ExitCode;

/**
 * `php craft luminx/snapshot` — create, list or restore (§10).
 *
 * The action lives in the request, not in the command name, so one protocol shape covers all
 * three and the adapter needs one client method.
 */
final class SnapshotController extends Controller
{
    public string $requestPath = '';

    public string $responsePath = '';

    /** @return list<string> */
    public function options($actionID): array
    {
        return [...parent::options($actionID), 'requestPath', 'responsePath'];
    }

    public function actionIndex(): int
    {
        if ($this->requestPath === '' || $this->responsePath === '') {
            return ExitCode::USAGE;
        }

        $writer = new ResponseWriter();
        $service = new SnapshotService();

        try {
            $payload = (new RequestReader())->read($this->requestPath);
            $action = (string) ($payload['action'] ?? 'create');

            $data = match ($action) {
                'create' => $service->create((string) ($payload['planHash'] ?? '')),
                'list' => ['snapshots' => $service->list()],
                'restore' => $this->restore($service, (string) ($payload['id'] ?? '')),
                default => throw ApplyException::failed('snapshot', 'unknown action ' . $action),
            };

            $writer->write($this->responsePath, Envelope::success($data, $this->diagnostics()));
        } catch (ApplyException | ProtocolException $exception) {
            $writer->write($this->responsePath, Envelope::failure([$exception->toArray()], $this->diagnostics()));
        } catch (Throwable $exception) {
            $writer->write($this->responsePath, Envelope::failure([[
                'code' => 'LX5001',
                'message' => $exception->getMessage(),
                'hint' => 'This is a bug in craft-luminx.',
            ]], $this->diagnostics()));
        }

        return ExitCode::OK;
    }

    /** @return array<string, mixed> */
    private function restore(SnapshotService $service, string $id): array
    {
        if ($id === '') {
            $latest = $service->list()[0] ?? throw ApplyException::restoreFailed('there are no snapshots');
            $id = $latest['id'];
        }

        if (!Craft::$app->getConfig()->getGeneral()->allowAdminChanges) {
            throw ApplyException::adminChangesDisabled();
        }

        $service->restore($id);
        Craft::$app->getProjectConfig()->saveModifiedConfigData();

        return ['restored' => $id];
    }

    /** @return array<string, string> */
    private function diagnostics(): array
    {
        return ['craftVersion' => Craft::$app->getVersion(), 'phpVersion' => PHP_VERSION];
    }
}
