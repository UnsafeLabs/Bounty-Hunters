<?php

namespace Tests\Feature;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Services\WebhookDispatcher;
use Illuminate\Foundation\Testing\TestCase;
use Illuminate\Support\Facades\Http;

class WebhookTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware();
    }

    public function test_create_webhook(): void
    {
        $response = $this->postJson('/api/webhooks', [
            'url' => 'https://example.com/webhook',
            'events' => ['order.created', 'order.updated'],
            'active' => true,
        ]);

        $response->assertStatus(201);
        $response->assertJsonStructure(['id', 'url', 'secret', 'events', 'active', 'created_at']);
        $this->assertEquals('https://example.com/webhook', $response->json('url'));
        $this->assertEquals(['order.created', 'order.updated'], $response->json('events'));
        $this->assertEquals(64, strlen($response->json('secret')));
    }

    public function test_list_webhooks(): void
    {
        Webhook::create([
            'url' => 'https://example.com/hook1',
            'secret' => bin2hex(random_bytes(32)),
            'events' => ['event.a'],
            'active' => true,
        ]);

        Webhook::create([
            'url' => 'https://example.com/hook2',
            'secret' => bin2hex(random_bytes(32)),
            'events' => ['event.b'],
            'active' => false,
        ]);

        $response = $this->getJson('/api/webhooks');

        $response->assertStatus(200);
        $this->assertCount(2, $response->json());
    }

    public function test_update_webhook(): void
    {
        $webhook = Webhook::create([
            'url' => 'https://example.com/old',
            'secret' => bin2hex(random_bytes(32)),
            'events' => ['old.event'],
            'active' => true,
        ]);

        $response = $this->putJson("/api/webhooks/{$webhook->id}", [
            'url' => 'https://example.com/new',
            'events' => ['new.event'],
        ]);

        $response->assertStatus(200);
        $this->assertEquals('https://example.com/new', $response->json('url'));
        $this->assertEquals(['new.event'], $response->json('events'));
    }

    public function test_delete_webhook(): void
    {
        $webhook = Webhook::create([
            'url' => 'https://example.com/to-delete',
            'secret' => bin2hex(random_bytes(32)),
            'events' => ['event'],
            'active' => true,
        ]);

        $response = $this->deleteJson("/api/webhooks/{$webhook->id}");

        $response->assertStatus(204);
        $this->assertDatabaseMissing('webhooks', ['id' => $webhook->id]);
    }

    public function test_signature_generation(): void
    {
        $dispatcher = new WebhookDispatcher(app(\Illuminate\Http\Client\Factory::class));
        $payload = ['foo' => 'bar', 'baz' => 123];
        $secret = 'test-secret-key';

        $sig1 = $dispatcher->signPayload($payload, $secret);
        $sig2 = $dispatcher->signPayload($payload, $secret);

        $this->assertEquals(64, strlen($sig1));
        $this->assertEquals($sig1, $sig2);

        $differentPayload = ['foo' => 'different'];
        $sig3 = $dispatcher->signPayload($differentPayload, $secret);
        $this->assertNotEquals($sig1, $sig3);
    }

    public function test_retry_timing_calculation(): void
    {
        $dispatcher = new WebhookDispatcher(app(\Illuminate\Http\Client\Factory::class));

        $retry1 = $dispatcher->calculateNextRetry(1);
        $retry2 = $dispatcher->calculateNextRetry(2);
        $retry3 = $dispatcher->calculateNextRetry(3);

        $this->assertEqualsWithDelta(2, now()->diffInSeconds($retry1), 1);
        $this->assertEqualsWithDelta(4, now()->diffInSeconds($retry2), 1);
        $this->assertEqualsWithDelta(8, now()->diffInSeconds($retry3), 1);
    }

    public function test_dispatch_creates_delivery_record(): void
    {
        Http::fake([
            'example.com/*' => Http::response(['ok' => true], 200),
        ]);

        $webhook = Webhook::create([
            'url' => 'https://example.com/webhook',
            'secret' => 'test-secret',
            'events' => ['order.created'],
            'active' => true,
        ]);

        $dispatcher = new WebhookDispatcher(Http::fake());
        $delivery = $dispatcher->dispatch($webhook, 'order.created', ['order_id' => 123]);

        $this->assertNotNull($delivery);
        $this->assertEquals(200, $delivery->response_code);
        $this->assertEquals(1, $delivery->attempts);
        $this->assertNotNull($delivery->delivered_at);
        $this->assertNull($delivery->next_retry_at);

        Http::assertSent(function ($request) {
            return $request->hasHeader('X-Webhook-Signature')
                && $request->hasHeader('X-Webhook-Event');
        });
    }

    public function test_dispatch_failed_sets_retry(): void
    {
        Http::fake([
            'example.com/*' => Http::response(['error'], 500),
        ]);

        $webhook = Webhook::create([
            'url' => 'https://example.com/webhook',
            'secret' => 'test-secret',
            'events' => ['event'],
            'active' => true,
        ]);

        $dispatcher = new WebhookDispatcher(Http::fake());
        $delivery = $dispatcher->dispatch($webhook, 'event', ['data' => 'test']);

        $this->assertEquals(500, $delivery->response_code);
        $this->assertNull($delivery->delivered_at);
        $this->assertNotNull($delivery->next_retry_at);
    }

    public function test_webhook_has_delivery_relationship(): void
    {
        $webhook = Webhook::create([
            'url' => 'https://example.com/hook',
            'secret' => bin2hex(random_bytes(32)),
            'events' => ['test'],
            'active' => true,
        ]);

        WebhookDelivery::create([
            'webhook_id' => $webhook->id,
            'event' => 'test',
            'payload' => ['test' => true],
            'response_code' => 200,
            'attempts' => 1,
            'delivered_at' => now(),
        ]);

        $this->assertCount(1, $webhook->fresh()->deliveries);
    }

    public function test_create_webhook_requires_url_and_events(): void
    {
        $response = $this->postJson('/api/webhooks', []);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['url', 'events']);
    }
}
