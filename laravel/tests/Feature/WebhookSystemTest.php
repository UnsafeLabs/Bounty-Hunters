<?php

namespace Tests\Feature;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Services\WebhookDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class WebhookSystemTest extends TestCase
{
    use RefreshDatabase;

    public function test_create_webhook(): void
    {
        $response = $this->actingAs(\App\Models\User::factory()->create())
            ->postJson('/api/webhooks', [
                'url' => 'https://example.com/hook',
                'events' => ['order.created', 'order.shipped'],
            ]);

        $response->assertCreated();
        $this->assertDatabaseHas('webhooks', [
            'url' => 'https://example.com/hook',
        ]);
    }

    public function test_signature_computation(): void
    {
        $dispatcher = new WebhookDispatcher();
        $sig = $dispatcher->computeSignature('{"test":1}', 1000, 'secret123');
        $this->assertEquals(64, strlen($sig)); // SHA256 hex

        // Verify round-trip
        $this->assertTrue($dispatcher->verifySignature('{"test":1}', $sig, 1000, 'secret123'));
    }

    public function test_signature_rejects_replay(): void
    {
        $dispatcher = new WebhookDispatcher();
        $sig = $dispatcher->computeSignature('test', 1000, 'secret');
        // Timestamp too old
        $this->assertFalse($dispatcher->verifySignature('test', $sig, 1000, 'secret', 300));
    }

    public function test_delivery_retry_logic(): void
    {
        $delivery = WebhookDelivery::create([
            'webhook_id' => Webhook::factory()->create()->id,
            'event' => 'test.event',
            'payload' => ['data' => 'test'],
            'attempts' => 0,
        ]);

        $this->assertTrue($delivery->shouldRetry());
        
        $delivery->update(['attempts' => 3, 'response_code' => 500]);
        $this->assertFalse($delivery->fresh()->shouldRetry());
    }

    public function test_list_webhooks(): void
    {
        $user = \App\Models\User::factory()->create();
        Webhook::factory()->count(3)->create();

        $response = $this->actingAs($user)->getJson('/api/webhooks');
        $response->assertOk();
    }
}
