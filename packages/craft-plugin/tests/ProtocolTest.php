<?php

declare(strict_types=1);

use luminx\craft\Protocol\Envelope;
use luminx\craft\Protocol\ProtocolException;
use luminx\craft\Protocol\RequestReader;
use luminx\craft\Protocol\ResponseWriter;

function tempPath(string $name = 'req.json'): string
{
    $dir = sys_get_temp_dir() . '/luminx-' . bin2hex(random_bytes(4));
    mkdir($dir, 0o775, true);

    return $dir . '/' . $name;
}

describe('Envelope', function () {
    it('stamps the protocol version', function () {
        expect(Envelope::success(['a' => 1])->toArray()['protocolVersion'])->toBe(1);
    });

    it('carries data when it succeeded', function () {
        $body = Envelope::success(['a' => 1], ['craftVersion' => '5.6.0'])->toArray();

        expect($body['ok'])->toBeTrue();
        expect($body['data'])->toBe(['a' => 1]);
        expect($body['errors'])->toBe([]);
        expect($body['diagnostics'])->toBe(['craftVersion' => '5.6.0']);
    });

    // No half-built value for the CLI to read past an error.
    it('has no data at all when it failed', function () {
        $body = Envelope::failure([['code' => 'LX3001', 'message' => 'boom']])->toArray();

        expect($body['ok'])->toBeFalse();
        expect($body)->not->toHaveKey('data');
        expect($body['errors'][0]['code'])->toBe('LX3001');
    });
});

describe('RequestReader', function () {
    // No waiting in tests: the wait exists for a container's filesystem, not for a local file.
    $reader = new RequestReader(waitSeconds: 0.0);

    it('reads a request', function () use ($reader) {
        $path = tempPath();
        file_put_contents($path, json_encode(['protocolVersion' => 1, 'kinds' => ['section']]));

        expect($reader->read($path))->toBe(['protocolVersion' => 1, 'kinds' => ['section']]);
    });

    it('reports a missing file', function () use ($reader) {
        expect(fn () => $reader->read('/nope/absent.json'))
            ->toThrow(ProtocolException::class, 'no such file');
    });

    it('reports text that is not JSON', function () use ($reader) {
        $path = tempPath();
        file_put_contents($path, '{ not json');

        expect(fn () => $reader->read($path))->toThrow(ProtocolException::class);
    });

    it('rejects a JSON array, which is not a request', function () use ($reader) {
        $path = tempPath();
        file_put_contents($path, '[1,2]');

        expect(fn () => $reader->read($path))->toThrow(ProtocolException::class, 'expected a JSON object');
    });

    // `json_decode('{}', true)` gives the empty array, and `array_is_list([])` is true. An empty
    // object must be told apart from an empty array, or the user is told the wrong thing.
    it('reports a missing protocolVersion rather than assuming one', function () use ($reader) {
        $path = tempPath();
        file_put_contents($path, '{}');

        expect(fn () => $reader->read($path))->toThrow(ProtocolException::class, 'protocolVersion is missing');
    });

    it('still rejects an empty JSON array', function () use ($reader) {
        $path = tempPath();
        file_put_contents($path, '[]');

        expect(fn () => $reader->read($path))->toThrow(ProtocolException::class, 'expected a JSON object');
    });

    // There is no implicit compatibility. A wire format that silently half-works is worse than
    // one that stops, and the advice depends on which side is behind.
    it('refuses a version it does not speak, and says which side to update', function () use ($reader) {
        $path = tempPath();
        file_put_contents($path, json_encode(['protocolVersion' => 2]));

        try {
            $reader->read($path);
            $this->fail('expected a ProtocolException');
        } catch (ProtocolException $exception) {
            expect($exception->errorCode)->toBe('LX3001');
            expect($exception->hint)->toContain('composer update');
        }

        file_put_contents($path, json_encode(['protocolVersion' => 0]));

        try {
            $reader->read($path);
            $this->fail('expected a ProtocolException');
        } catch (ProtocolException $exception) {
            expect($exception->hint)->toContain('npm install');
        }
    });
});

describe('ResponseWriter', function () {
    $writer = new ResponseWriter();

    it('writes an envelope the CLI can parse', function () use ($writer) {
        $path = tempPath('res.json');
        $writer->write($path, Envelope::success(['resources' => []]));

        $decoded = json_decode((string) file_get_contents($path), true);

        expect($decoded['ok'])->toBeTrue();
        expect($decoded['protocolVersion'])->toBe(1);
    });

    it('creates the directory when it does not exist yet', function () use ($writer) {
        $path = sys_get_temp_dir() . '/luminx-' . bin2hex(random_bytes(4)) . '/nested/res.json';
        $writer->write($path, Envelope::success(null));

        expect(file_exists($path))->toBeTrue();
    });

    // The one failure mode file transport has that a pipe does not: a half-written response.
    it('leaves no temporary file behind', function () use ($writer) {
        $path = tempPath('res.json');
        $writer->write($path, Envelope::success(null));

        expect(glob(dirname($path) . '/*.tmp'))->toBe([]);
    });

    it('does not escape slashes or unicode', function () use ($writer) {
        $path = tempPath('res.json');
        $writer->write($path, Envelope::success(['uri' => 'pages/{slug}', 'name' => 'Café']));

        $raw = (string) file_get_contents($path);

        expect($raw)->toContain('pages/{slug}');
        expect($raw)->toContain('Café');
    });
});
