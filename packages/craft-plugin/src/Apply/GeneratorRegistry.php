<?php

declare(strict_types=1);

namespace luminx\craft\Apply;

use luminx\craft\Apply\Generators\CategoryGenerator;
use luminx\craft\Apply\Generators\EntryTypeGenerator;
use luminx\craft\Apply\Generators\FieldGenerator;
use luminx\craft\Apply\Generators\FilesystemGenerator;
use luminx\craft\Apply\Generators\GlobalSetGenerator;
use luminx\craft\Apply\Generators\SectionGenerator;
use luminx\craft\Apply\Generators\UserGroupGenerator;
use luminx\craft\Apply\Generators\VolumeGenerator;

/** Generators by ResourceKind. A kind with no generator is a kind LuminX cannot write (§7.1). */
final class GeneratorRegistry
{
    /** @var array<string, Generator> */
    private array $generators = [];

    public function __construct()
    {
        foreach ([
            new FilesystemGenerator(),
            new VolumeGenerator(),
            new FieldGenerator(),
            new EntryTypeGenerator(),
            new SectionGenerator(),
            new CategoryGenerator(),
            new GlobalSetGenerator(),
            new UserGroupGenerator(),
        ] as $generator) {
            $this->register($generator);
        }
    }

    public function register(Generator $generator): void
    {
        $this->generators[$generator->kind()] = $generator;
    }

    public function get(string $kind): Generator
    {
        return $this->generators[$kind]
            ?? throw ApplyException::failed($kind, 'no generator for this resource kind');
    }
}
