<?php

declare(strict_types=1);

namespace luminx\craft\Client;

use Craft;
use craft\helpers\StringHelper;
use craft\models\GqlSchema;
use craft\models\GqlToken;
use Throwable;

/**
 * Opens a read-only door into Craft, so a frontend can read what LuminX put there.
 *
 * The content model is managed, the content is pushed — and then nothing reads it. A CMS whose
 * entries no site displays is an archive, not a CMS. This provisions the way back out: Craft's
 * GraphQL API, scoped to *reading* the sections the config describes, behind a token.
 *
 * **Read, never write.** The scopes are `:read` only. A token that could also write would be a
 * token that, if it leaked out of a frontend's environment, could rewrite the content it was meant
 * to display. There is no reason for the read side to hold that power, so it does not.
 *
 * Idempotent, like the rest of LuminX: the same schema is found and updated rather than duplicated,
 * and an existing token is reused. Running it twice does not litter Craft with schemas.
 */
final class GraphqlProvisioner
{
    private const SCHEMA_NAME = 'LuminX';

    /**
     * @return array{token: string, schemaUid: string, sections: list<string>, url: string, created: bool}
     * @throws ClientException
     */
    public function provision(): array
    {
        $gql = Craft::$app->getGql();

        // Every section, readable. The config decides what exists; this decides nothing.
        $scope = [];
        $sections = [];

        foreach (Craft::$app->getEntries()->getAllSections() as $section) {
            $scope[] = sprintf('sections.%s:read', $section->uid);
            $sections[] = $section->handle;
        }

        /**
         * And the sites, or the schema can read nothing at all.
         *
         * An entry belongs to a site, so a schema scoped to every section but no site answers every
         * query with `Schema doesn't have access to the "cms" site` — a 403, not an empty result.
         * The section scopes look complete and are useless without this. Found by asking a real
         * Craft rather than reasoning about one.
         */
        foreach (Craft::$app->getSites()->getAllSites() as $site) {
            $scope[] = sprintf('sites.%s:read', $site->uid);
        }

        if ($scope === []) {
            throw new ClientException('LX4001', 'Craft has no sections to read.', [
                'Run `luminx generate` first: there is no content model yet.',
            ]);
        }

        $schema = $this->schema($gql->getSchemas());
        $created = $schema === null;

        if ($schema === null) {
            $schema = new GqlSchema();
            $schema->name = self::SCHEMA_NAME;
            $schema->uid = StringHelper::UUID();
        }

        $schema->scope = $scope;

        if (!$gql->saveSchema($schema)) {
            throw new ClientException('LX4001', 'Craft rejected the GraphQL schema.', $this->errorsOf($schema));
        }

        /**
         * Craft's own address, from Craft.
         *
         * The CLI could guess — read `.env`, ask DDEV, assume localhost — and would be wrong the
         * first time someone ran this against a real host. The CMS is the only thing that knows
         * where it is, so it is the thing that says.
         */
        $baseUrl = Craft::$app->getSites()->getPrimarySite()->getBaseUrl();

        return [
            'token' => $this->token($schema),
            'schemaUid' => (string) $schema->uid,
            'sections' => $sections,
            'url' => rtrim((string) $baseUrl, '/'),
            'created' => $created,
        ];
    }

    /** @param list<GqlSchema> $schemas */
    private function schema(array $schemas): ?GqlSchema
    {
        foreach ($schemas as $schema) {
            if ($schema->name === self::SCHEMA_NAME) {
                return $schema;
            }
        }

        return null;
    }

    /**
     * The token for our schema — the existing one if there is one.
     *
     * Craft stores the access token in the clear, so it can be read back. That matters: a `luminx
     * client` run that minted a *new* token every time would silently invalidate nothing (old tokens
     * keep working) but would leave a trail of them, and the value written into `.env` would drift
     * from the one a previous run wrote. One token, reused.
     *
     * @throws ClientException
     */
    private function token(GqlSchema $schema): string
    {
        $gql = Craft::$app->getGql();

        foreach ($gql->getTokens() as $existing) {
            if ($existing->schemaId === $schema->id && $existing->name === self::SCHEMA_NAME) {
                return (string) $existing->accessToken;
            }
        }

        $token = new GqlToken([
            'name' => self::SCHEMA_NAME,
            'accessToken' => StringHelper::randomString(32),
            'enabled' => true,
            'schemaId' => $schema->id,
        ]);

        if (!$gql->saveToken($token)) {
            throw new ClientException('LX4001', 'Craft rejected the GraphQL token.', $this->errorsOf($token));
        }

        return (string) $token->accessToken;
    }

    /** @return list<string> */
    private function errorsOf(GqlSchema|GqlToken $model): array
    {
        $messages = [];

        foreach ($model->getErrors() as $attribute => $errors) {
            foreach ((array) $errors as $error) {
                $messages[] = sprintf('%s: %s', $attribute, (string) $error);
            }
        }

        return $messages;
    }
}
