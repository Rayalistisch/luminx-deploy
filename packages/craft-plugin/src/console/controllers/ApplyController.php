<?php

declare(strict_types=1);

namespace luminx\craft\console\controllers;

use Craft;
use craft\console\Controller;
use luminx\craft\Apply\Applier;
use luminx\craft\Apply\ApplyException;
use luminx\craft\Protocol\Envelope;
use luminx\craft\Protocol\ProtocolException;
use luminx\craft\Protocol\RequestReader;
use luminx\craft\Protocol\ResponseWriter;
use Throwable;
use yii\console\ExitCode;

/**
 * `php craft luminx/apply --requestPath=… --responsePath=…`
 *
 * The first controller that writes. Nothing is printed to stdout; the envelope carries the result,
 * and the exit code reports only whether the envelope could be delivered.
 */
final class ApplyController extends Controller
{
    /** Not `$request` / `$response`: yii\base\Controller owns both, untyped. */
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

        try {
            $payload = (new RequestReader())->read($this->requestPath);

            /** @var list<array<string, mixed>> $operations */
            $operations = (array) ($payload['operations'] ?? []);
            /** @var array<string, string> $resolved */
            $resolved = (array) ($payload['resolved'] ?? []);

            $applied = (new Applier())->apply($operations, $resolved);

            $writer->write($this->responsePath, Envelope::success($applied, $this->diagnostics()));
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

    /** @return array<string, string> */
    private function diagnostics(): array
    {
        return [
            'craftVersion' => Craft::$app->getVersion(),
            'phpVersion' => PHP_VERSION,
        ];
    }
}
