<?php

namespace Tests\Unit;

use App\Services\WebhookDispatcher;
use PHPUnit\Framework\TestCase;

class WebhookSignatureTest extends TestCase
{
    public function test_signature_is_an_hmac_sha256_digest_of_the_payload(): void
    {
        $dispatcher = new WebhookDispatcher;

        $signature = $dispatcher->signature('{"id":1}', 'top-secret');

        $this->assertSame('sha256='.hash_hmac('sha256', '{"id":1}', 'top-secret'), $signature);
        $this->assertStringStartsWith('sha256=', $signature);
        $this->assertSame(71, strlen($signature));
    }

    public function test_signature_changes_with_the_payload_and_the_secret(): void
    {
        $dispatcher = new WebhookDispatcher;

        $base = $dispatcher->signature('{"id":1}', 'secret-a');

        $this->assertNotSame($base, $dispatcher->signature('{"id":2}', 'secret-a'));
        $this->assertNotSame($base, $dispatcher->signature('{"id":1}', 'secret-b'));
    }

    public function test_backoff_grows_exponentially_from_one_minute(): void
    {
        $dispatcher = new WebhookDispatcher;

        $this->assertSame(60, $dispatcher->backoffSeconds(1));
        $this->assertSame(120, $dispatcher->backoffSeconds(2));
        $this->assertSame(240, $dispatcher->backoffSeconds(3));
        $this->assertSame(480, $dispatcher->backoffSeconds(4));
        $this->assertSame(960, $dispatcher->backoffSeconds(5));
    }

    public function test_backoff_is_clamped_to_the_maximum(): void
    {
        $dispatcher = new WebhookDispatcher;

        $this->assertSame(WebhookDispatcher::MAX_BACKOFF, $dispatcher->backoffSeconds(20));
    }

    public function test_backoff_treats_non_positive_attempts_as_the_first_one(): void
    {
        $dispatcher = new WebhookDispatcher;

        $this->assertSame(60, $dispatcher->backoffSeconds(0));
        $this->assertSame(60, $dispatcher->backoffSeconds(-3));
    }

    public function test_delivery_budget_is_five_attempts(): void
    {
        $this->assertSame(5, WebhookDispatcher::MAX_ATTEMPTS);
    }
}
