<?php

namespace Tests\Unit;

use App\Services\WebhookDispatcher;
use PHPUnit\Framework\TestCase;

class WebhookDispatcherTest extends TestCase
{
    public function test_signature_generation_uses_hmac_sha256_over_canonical_json(): void
    {
        $dispatcher = new WebhookDispatcher();
        $payload = ['event' => 'user.created', 'payload' => ['id' => 123]];

        $expected = hash_hmac(
            'sha256',
            json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'super-secret',
        );

        $this->assertSame($expected, $dispatcher->signatureForPayload('super-secret', $payload));
    }

    public function test_retry_timing_uses_exponential_backoff(): void
    {
        $dispatcher = new WebhookDispatcher();

        $this->assertSame(60, $dispatcher->retryDelaySeconds(1));
        $this->assertSame(120, $dispatcher->retryDelaySeconds(2));
        $this->assertSame(240, $dispatcher->retryDelaySeconds(3));
        $this->assertSame(480, $dispatcher->retryDelaySeconds(4));
        $this->assertSame(960, $dispatcher->retryDelaySeconds(5));
    }
}
