<?php

namespace Tests\Unit;

use App\Models\Webhook;
use App\Services\WebhookDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class WebhookDispatcherTest extends TestCase
{
    use RefreshDatabase;

    public function test_signature_generation_uses_hmac_sha256(): void
    {
        $dispatcher = new WebhookDispatcher();
        $body = '{"event":"user.created"}';

        $this->assertSame(
            'sha256='.hash_hmac('sha256', $body, 'top-secret'),
            $dispatcher->signature('top-secret', $body),
        );
    }

    public function test_retry_delay_uses_exponential_backoff(): void
    {
        $dispatcher = new WebhookDispatcher();

        $this->assertSame(60, $dispatcher->retryDelaySeconds(1));
        $this->assertSame(120, $dispatcher->retryDelaySeconds(2));
        $this->assertSame(240, $dispatcher->retryDelaySeconds(3));
        $this->assertSame(960, $dispatcher->retryDelaySeconds(5));
    }

    public function test_successful_delivery_is_signed_and_recorded(): void
    {
        Http::fake([
            'example.test/*' => Http::response(['ok' => true], 204),
        ]);

        $webhook = Webhook::query()->create([
            'url' => 'https://example.test/hooks',
            'secret' => 'top-secret',
            'events' => ['user.created'],
            'active' => true,
        ]);

        $dispatcher = new WebhookDispatcher();
        $delivery = $dispatcher->send($webhook, 'user.created', ['id' => 123]);

        Http::assertSent(function ($request): bool {
            return $request->hasHeader('X-Webhook-Event', 'user.created')
                && $request->hasHeader('X-Webhook-Signature', 'sha256='.hash_hmac('sha256', '{"id":123}', 'top-secret'))
                && $request->body() === '{"id":123}';
        });

        $this->assertSame(204, $delivery->response_code);
        $this->assertSame(1, $delivery->attempts);
        $this->assertNotNull($delivery->delivered_at);
        $this->assertNull($delivery->next_retry_at);
    }

    public function test_failed_delivery_records_next_retry(): void
    {
        Http::fake([
            'example.test/*' => Http::response(['error' => true], 500),
        ]);

        $webhook = Webhook::query()->create([
            'url' => 'https://example.test/hooks',
            'secret' => 'top-secret',
            'events' => ['user.created'],
            'active' => true,
        ]);

        $delivery = (new WebhookDispatcher())->send($webhook, 'user.created', ['id' => 123]);

        $this->assertSame(500, $delivery->response_code);
        $this->assertSame(1, $delivery->attempts);
        $this->assertNull($delivery->delivered_at);
        $this->assertNotNull($delivery->next_retry_at);
        $this->assertTrue($delivery->shouldRetry());
    }
}
