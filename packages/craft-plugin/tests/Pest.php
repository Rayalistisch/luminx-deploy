<?php

declare(strict_types=1);

/**
 * Nothing here boots Craft.
 *
 * Every test in this package runs against the `ArrayGateway` and plain files, which is the whole
 * point of the gateway seam: the mappings that decide what LuminX believes about a CMS are
 * verified without a database, a web server, or a Craft install.
 *
 * The thin layer that reads Craft's own services — `CraftGateway` — has no test here, because a
 * test of it without Craft would test nothing. It is verified against a real installation in M7.
 */
