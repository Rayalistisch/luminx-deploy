<?php

declare(strict_types=1);

namespace luminx\craft\console\controllers;

use Craft;
use craft\console\Controller;
use luminx\craft\Introspect\CraftGateway;
use luminx\craft\Introspect\Introspector;
use luminx\craft\Protocol\Envelope;
use luminx\craft\Protocol\ProtocolException;
use luminx\craft\Protocol\RequestReader;
use luminx\craft\Protocol\ResponseWriter;
use Throwable;
use yii\console\ExitCode;

/**
 * `php craft luminx/introspect --request=… --response=…` (§7.4).
 *
 * No business logic: parse the arguments, hand them to a service, write the envelope. Nothing is
 * printed to stdout — Craft, Yii and any installed plugin write there unbidden, which is the
 * whole reason the protocol travels through a file.
 *
 * Read-only. This controller cannot change anything, whatever the request says.
 */
final class IntrospectController extends Controller
{
    /**
     * Not `$request` and `$response`.
     *
     * `yii\base\Controller` already declares both, untyped, for the Request and Response
     * components it injects. Redeclaring them as typed strings is a compile error, and one that
     * appears only when Craft loads the class — never in a test that does not boot Craft.
     */
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
            // Nowhere to write an envelope to, so the exit code is the only channel left.
            return ExitCode::USAGE;
        }

        $writer = new ResponseWriter();

        try {
            $payload = (new RequestReader())->read($this->requestPath);

            /** @var list<string>|null $kinds */
            $kinds = is_array($payload['kinds'] ?? null) ? array_values($payload['kinds']) : null;

            $resources = (new Introspector())->introspect(new CraftGateway(), $kinds);

            $writer->write(
                $this->responsePath,
                Envelope::success(['resources' => $resources], $this->diagnostics()),
            );

            return ExitCode::OK;
        } catch (ProtocolException $exception) {
            $writer->write($this->responsePath, Envelope::failure([$exception->toArray()], $this->diagnostics()));

            return ExitCode::OK;
        } catch (Throwable $exception) {
            // A bug in the plugin. The envelope still arrives, so the CLI can name it (LX5001).
            $writer->write($this->responsePath, Envelope::failure([[
                'code' => 'LX5001',
                'message' => $exception->getMessage(),
                'hint' => 'This is a bug in craft-luminx.',
            ]], $this->diagnostics()));

            return ExitCode::OK;
        }
    }

    /**
     * The exit code reports transport failure; a domain failure travels inside the envelope. So an
     * envelope that was written successfully exits 0 even when it carries errors — otherwise the
     * CLI could not tell "the plugin could not answer" from "the plugin answered: no".
     *
     * @return array<string, string>
     */
    private function diagnostics(): array
    {
        return [
            'craftVersion' => Craft::$app->getVersion(),
            'phpVersion' => PHP_VERSION,
            'pluginVersion' => Craft::$app->getPlugins()->getPluginInfo('luminx')['version'] ?? 'unknown',
        ];
    }
}
