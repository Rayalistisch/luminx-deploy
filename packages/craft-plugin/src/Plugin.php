<?php

declare(strict_types=1);

namespace luminx\craft;

use Craft;
use craft\base\Plugin as BasePlugin;
use craft\console\Application as ConsoleApplication;

/**
 * The LuminX plugin for Craft 5 (§3.6, §9.1).
 *
 * An executor, not a configuration store. It has **no settings model and no settings view**: the
 * content model lives in `luminx.config.json`, under version control, and a second place to
 * configure the same thing is a second place for the two to disagree.
 *
 * It registers console controllers and nothing else. There are no control-panel routes, no
 * event listeners on save, and no scheduled jobs. Everything it does, it does because the CLI
 * asked it to, once, and told it exactly what to do.
 */
final class Plugin extends BasePlugin
{
    public string $schemaVersion = '1.0.0';

    public function init(): void
    {
        parent::init();

        if (Craft::$app instanceof ConsoleApplication) {
            $this->controllerNamespace = 'luminx\\craft\\console\\controllers';
        }
    }
}
