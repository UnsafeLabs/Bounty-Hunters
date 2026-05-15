<?php

namespace Tests\Unit;

use App\Jobs\DispatchWebhookJob;
use App\Services\WebhookDispatcher;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\TestCase;

class WebhookDispatcherTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_signature_generation_uses_hmac_sha256_over_encoded_payload(): void
    {
        $dispatcher = new WebhookDispatcher;
        $payload = [
            'event' => 'invoice.paid',
            'invoice_id' => 42,
            'callback_url' => 'https://example.com/hooks/invoices',
        ];

        $signature = $dispatcher->generateSignature('super-secret-key', $payload);

        $this->assertSame(
            hash_hmac(
                'sha256',
                json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                'super-secret-key'
            ),
            $signature
        );
    }

    public function test_signature_verification_uses_constant_time_comparison(): void
    {
        $dispatcher = new WebhookDispatcher;
        $payload = ['event' => 'invoice.paid', 'invoice_id' => 42];
        $signature = $dispatcher->generateSignature('super-secret-key', $payload);

        $this->assertTrue($dispatcher->verifySignature('super-secret-key', $payload, $signature));
        $this->assertFalse($dispatcher->verifySignature('super-secret-key', $payload, str_repeat('0', 64)));
    }

    public function test_retry_timing_uses_exponential_backoff(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-16 00:00:00'));

        $dispatcher = new WebhookDispatcher;

        $this->assertSame([2, 4, 8, 16, 32], [
            $dispatcher->calculateBackoffSeconds(1),
            $dispatcher->calculateBackoffSeconds(2),
            $dispatcher->calculateBackoffSeconds(3),
            $dispatcher->calculateBackoffSeconds(4),
            $dispatcher->calculateBackoffSeconds(5),
        ]);

        $this->assertTrue(
            CarbonImmutable::parse('2026-05-16 00:00:08')->equalTo($dispatcher->calculateNextRetryAt(3))
        );
    }

    public function test_dispatch_job_limits_attempts_and_uses_exponential_backoff(): void
    {
        $job = new DispatchWebhookJob(123);

        $this->assertSame(WebhookDispatcher::MAX_ATTEMPTS, $job->tries);
        $this->assertSame([2, 4, 8, 16, 32], $job->backoff());
    }
}
