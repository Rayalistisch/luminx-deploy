<?php

declare(strict_types=1);

use luminx\craft\Apply\WriteStrategy;

/**
 * The write-strategy seam, tested without Craft. `ServiceApiWriteStrategy` reads `Craft::$app`, so
 * it is exercised against a real install in M7's DDEV runs, not here. What this holds is the
 * contract the seam promises: a strategy that cannot write says why, so the CLI can point at
 * deploy instead of failing mid-apply (§11.2).
 */
final class RefusingStrategy implements WriteStrategy
{
    public bool $flushed = false;

    public function canWrite(): bool
    {
        return false;
    }

    public function reason(): ?string
    {
        return 'allowAdminChanges is off';
    }

    public function flush(): void
    {
        $this->flushed = true;
    }
}

final class WritingStrategy implements WriteStrategy
{
    public bool $flushed = false;

    public function canWrite(): bool
    {
        return true;
    }

    public function reason(): ?string
    {
        return null;
    }

    public function flush(): void
    {
        $this->flushed = true;
    }
}

it('a strategy that cannot write gives a reason the CLI can show', function () {
    $strategy = new RefusingStrategy();

    expect($strategy->canWrite())->toBeFalse();
    expect($strategy->reason())->toBeString()->not->toBeEmpty();
});

it('a strategy that can write has no reason to give', function () {
    $strategy = new WritingStrategy();

    expect($strategy->canWrite())->toBeTrue();
    expect($strategy->reason())->toBeNull();
});

it('flush is part of the contract, so a strategy can defer the write', function () {
    $strategy = new WritingStrategy();
    $strategy->flush();

    expect($strategy->flushed)->toBeTrue();
});
