<?php

namespace Tests\Unit;

use App\Services\WebhookDispatcher;
use PHPUnit\Framework\TestCase;

class WebhookSignatureTest extends TestCase
{
    public function test_signature_is_hmac_sha256_of_payload(): void
    {
        $dispatcher = new WebhookDispatcher();
        $payload = '{"event":"order.created","payload":{"id":1}}';
        $secret = 'super-secret';

        $this->assertSame(
            hash_hmac('sha256', $payload, $secret),
            $dispatcher->sign($payload, $secret)
        );
    }

    public function test_signature_is_deterministic(): void
    {
        $dispatcher = new WebhookDispatcher();

        $this->assertSame(
            $dispatcher->sign('payload', 'secret'),
            $dispatcher->sign('payload', 'secret')
        );
    }

    public function test_signature_changes_with_secret_and_payload(): void
    {
        $dispatcher = new WebhookDispatcher();

        $this->assertNotSame(
            $dispatcher->sign('payload', 'secret-a'),
            $dispatcher->sign('payload', 'secret-b')
        );

        $this->assertNotSame(
            $dispatcher->sign('payload-a', 'secret'),
            $dispatcher->sign('payload-b', 'secret')
        );
    }

    public function test_signature_is_a_64_character_hex_digest(): void
    {
        $dispatcher = new WebhookDispatcher();

        $this->assertMatchesRegularExpression(
            '/^[0-9a-f]{64}$/',
            $dispatcher->sign('payload', 'secret')
        );
    }
}
