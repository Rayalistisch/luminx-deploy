<?php

declare(strict_types=1);

namespace luminx\craft\console\controllers;

use Craft;
use craft\console\Controller;
use luminx\craft\Content\ContentException;
use luminx\craft\Content\ContentWriter;
use luminx\craft\Protocol\Envelope;
use luminx\craft\Protocol\ProtocolException;
use luminx\craft\Protocol\RequestReader;
use luminx\craft\Protocol\ResponseWriter;
use Throwable;
use yii\console\ExitCode;

/**
 * `php craft luminx/content --requestPath=… --responsePath=…`
 *
 * Writes entries. Unlike `apply`, this touches the database rather than the project config, and it
 * never deletes — see ContentWriter for why that asymmetry is deliberate.
 */
final class ContentController extends Controller
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

            /** @var list<array<string, mixed>> $entries */
            $entries = (array) ($payload['entries'] ?? []);

            $written = (new ContentWriter())->write($entries);

            $writer->write($this->responsePath, Envelope::success($written, $this->diagnostics()));
        } catch (ContentException | ProtocolException $exception) {
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
