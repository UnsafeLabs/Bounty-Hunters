<?php

namespace Tests\Unit;

use App\Services\WebhookDispatcher;
use Tests\TestCase;

class WebhookTest extends TestCase
{
    private WebhookDispatcher $dispatcher;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dispatcher = new WebhookDispatcher();
    }

    public function test_sign_generates_valid_hmac_sha256(): void
    {
        $payload = '{"event":"test"}';
        $secret = 'my-secret-key';

        $this->assertSame(
            hash_hmac('sha256', $payload, $secret),
            $this->dispatcher->sign($payload, $secret)
        );
    }

    public function test_sign_is_deterministic(): void
    {
        $payload = '{"event":"test"}';
        $secret = 'my-secret-key';

        $this->assertSame(
            $this->dispatcher->sign($payload, $secret),
            $this->dispatcher->sign($payload, $secret)
        );
    }

    public function test_sign_differs_for_different_secrets(): void
    {
        $this->assertNotSame(
            $this->dispatcher->sign('payload', 'secret-a'),
            $this->dispatcher->sign('payload', 'secret-b')
        );
    }

    public function test_next_retry_at_first_attempt_is_60_seconds(): void
    {
        $retryAt = $this->dispatcher->nextRetryAt(1);

        $this->assertEqualsWithDelta(
            now()->addSeconds(60)->getTimestamp(),
            $retryAt->getTimestamp(),
            2
        );
    }

    public function test_next_retry_at_doubles_with_each_attempt(): void
    {
        $first = $this->dispatcher->nextRetryAt(1)->getTimestamp() - now()->getTimestamp();
        $second = $this->dispatcher->nextRetryAt(2)->getTimestamp() - now()->getTimestamp();
        $third = $this->dispatcher->nextRetryAt(3)->getTimestamp() - now()->getTimestamp();

        $this->assertEqualsWithDelta(120, $second, 2);
        $this->assertEqualsWithDelta(240, $third, 2);
        $this->assertGreaterThan($first, $second);
        $this->assertGreaterThan($second, $third - $first);
    }

    public function test_next_retry_at_fifth_attempt_is_960_seconds(): void
    {
        $retryAt = $this->dispatcher->nextRetryAt(5);

        $this->assertEqualsWithDelta(
            now()->addSeconds(960)->getTimestamp(),
            $retryAt->getTimestamp(),
            2
        );
    }
}
