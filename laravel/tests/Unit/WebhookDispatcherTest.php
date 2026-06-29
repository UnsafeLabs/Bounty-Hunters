<?php

namespace Tests\Unit;

use App\Services\WebhookDispatcher;
use PHPUnit\Framework\TestCase;

class WebhookDispatcherTest extends TestCase
{
    public function test_signature_generation_uses_hmac_sha256_over_json_body(): void
    {
        $body = WebhookDispatcher::encodePayload('user.created', ['id' => 42]);
        $signature = WebhookDispatcher::signatureFor($body, 'super-secret');

        $this->assertSame(
            'sha256='.hash_hmac('sha256', $body, 'super-secret'),
            $signature
        );
        $this->assertTrue(WebhookDispatcher::verifySignature($body, 'super-secret', $signature));
        $this->assertFalse(WebhookDispatcher::verifySignature($body, 'wrong-secret', $signature));
    }

    public function test_retry_delay_uses_exponential_backoff(): void
    {
        $this->assertSame(60, WebhookDispatcher::retryDelaySeconds(1));
        $this->assertSame(120, WebhookDispatcher::retryDelaySeconds(2));
        $this->assertSame(240, WebhookDispatcher::retryDelaySeconds(3));
        $this->assertSame(480, WebhookDispatcher::retryDelaySeconds(4));
    }
}
