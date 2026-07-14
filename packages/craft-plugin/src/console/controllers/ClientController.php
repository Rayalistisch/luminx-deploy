<?php

declare(strict_types=1);

namespace luminx\craft\console\controllers;

use Craft;
use craft\console\Controller;
use luminx\craft\Client\ClientException;
use luminx\craft\Client\GraphqlProvisioner;
use luminx\craft\Protocol\Envelope;
use luminx\craft\Protocol\ProtocolException;
use luminx\craft\Protocol\ResponseWriter;
use Throwable;
use yii\console\ExitCode;

/**
 * `php craft luminx/client --responsePath=…`
 *
 * Opens the read side: a GraphQL schema scoped to reading the sections that exist, and a token for
 * it. Takes no request — there is nothing to say, only something to ask for.
 */
final class ClientController extends Controller
{
    /** Not `$request` / `$response`: yii\base\Controller owns both, untyped. */
    public string $requestPath = '';

    public string $responsePath = '';

    /**
     * `requestPath` is accepted and unused.
     *
     * There is nothing to ask for — the CMS knows its own sections and its own address. But the
     * protocol client writes a request file and passes the flag for every call, and a controller
     * that rejects an option the protocol always sends is a controller that never runs.
     *
     * @return list<string>
     */
    public function options($actionID): array
    {
        return [...parent::options($actionID), 'requestPath', 'responsePath'];
    }

    public function actionIndex(): int
    {
        if ($this->responsePath === '') {
            return ExitCode::USAGE;
        }

        $writer = new ResponseWriter();

        try {
            $provisioned = (new GraphqlProvisioner())->provision();

            $writer->write($this->responsePath, Envelope::success($provisioned, $this->diagnostics()));
        } catch (ClientException | ProtocolException $exception) {
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
