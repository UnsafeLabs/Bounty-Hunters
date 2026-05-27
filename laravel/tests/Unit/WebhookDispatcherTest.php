<?php

namespace Tests\Unit;

use App\Jobs\DispatchWebhookJob;
use App\Services\WebhookDispatcher;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class WebhookDispatcherTest extends TestCase
{
    public function test_signature_uses_hmac_sha256_prefix(): void
    {
        $dispatcher = new WebhookDispatcher;
        $body = '{"order_id":123}';
        $secret = 'super-secret-signing-key';

        $signature = $dispatcher->signature($body, $secret);

        $this->assertSame('sha256='.hash_hmac('sha256', $body, $secret), $signature);
        $this->assertTrue($dispatcher->signatureIsValid($body, $secret, $signature));
        $this->assertFalse($dispatcher->signatureIsValid($body, $secret, 'sha256=bad'));
    }

    public function test_json_body_preserves_unescaped_slashes(): void
    {
        $body = (new WebhookDispatcher)->jsonBody([
            'url' => 'https://example.com/orders/123',
        ]);

        $this->assertSame('{"url":"https://example.com/orders/123"}', $body);
    }

    public function test_retry_delays_match_exponential_backoff_schedule(): void
    {
        $dispatcher = new WebhookDispatcher;

        $this->assertSame(60, $dispatcher->retryDelay(1));
        $this->assertSame(300, $dispatcher->retryDelay(2));
        $this->assertSame(900, $dispatcher->retryDelay(3));
        $this->assertSame(1800, $dispatcher->retryDelay(4));
        $this->assertSame(1800, $dispatcher->retryDelay(5));
    }

    public function test_next_retry_at_uses_attempt_delay(): void
    {
        Carbon::setTestNow('2026-05-27 12:00:00');

        $nextRetryAt = (new WebhookDispatcher)->nextRetryAt(2);

        $this->assertTrue($nextRetryAt->equalTo(Carbon::parse('2026-05-27 12:05:00')));

        Carbon::setTestNow();
    }

    public function test_job_retry_configuration_is_explicit(): void
    {
        $job = new DispatchWebhookJob(123);

        $this->assertSame(5, $job->tries);
        $this->assertSame([60, 300, 900, 1800], $job->backoff());
    }
}
