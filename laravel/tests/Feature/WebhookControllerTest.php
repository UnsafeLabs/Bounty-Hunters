<?php

namespace Tests\Feature;

use App\Models\Webhook;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class WebhookControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_webhook_crud_endpoints_work(): void
    {
        $createResponse = $this->postJson('/api/webhooks', [
            'url' => 'https://example.com/webhooks/orders',
            'events' => ['order.created'],
        ]);

        $createResponse
            ->assertCreated()
            ->assertJsonPath('url', 'https://example.com/webhooks/orders')
            ->assertJsonPath('events', ['order.created'])
            ->assertJsonPath('active', true);

        $webhookId = $createResponse->json('id');
        $this->assertDatabaseHas('webhooks', [
            'id' => $webhookId,
            'url' => 'https://example.com/webhooks/orders',
            'active' => true,
        ]);

        $this->getJson('/api/webhooks')
            ->assertOk()
            ->assertJsonFragment(['url' => 'https://example.com/webhooks/orders']);

        $this->patchJson("/api/webhooks/{$webhookId}", [
            'events' => ['order.created', 'order.shipped'],
            'active' => false,
        ])
            ->assertOk()
            ->assertJsonPath('events', ['order.created', 'order.shipped'])
            ->assertJsonPath('active', false);

        $this->getJson("/api/webhooks/{$webhookId}")
            ->assertOk()
            ->assertJsonPath('id', $webhookId)
            ->assertJsonPath('deliveries', []);

        $this->deleteJson("/api/webhooks/{$webhookId}")->assertNoContent();
        $this->assertDatabaseMissing('webhooks', ['id' => $webhookId]);
    }

    public function test_webhook_creation_accepts_explicit_secret(): void
    {
        $this->postJson('/api/webhooks', [
            'url' => 'https://example.com/webhooks/manual-secret',
            'secret' => 'explicit-secret-value',
            'events' => ['customer.updated'],
            'active' => false,
        ])
            ->assertCreated()
            ->assertJsonPath('secret', 'explicit-secret-value')
            ->assertJsonPath('active', false);

        $this->assertDatabaseHas('webhooks', [
            'url' => 'https://example.com/webhooks/manual-secret',
            'secret' => 'explicit-secret-value',
            'active' => false,
        ]);
    }

    public function test_webhook_delete_cascades_delivery_history(): void
    {
        $webhook = Webhook::query()->create([
            'url' => 'https://example.com/webhooks/cascade',
            'secret' => 'cascade-secret-value',
            'events' => ['order.cancelled'],
            'active' => true,
        ]);

        $delivery = $webhook->deliveries()->create([
            'event' => 'order.cancelled',
            'payload' => ['id' => 9],
            'attempts' => 1,
        ]);

        $this->deleteJson("/api/webhooks/{$webhook->id}")->assertNoContent();

        $this->assertDatabaseMissing('webhook_deliveries', ['id' => $delivery->id]);
    }
}
