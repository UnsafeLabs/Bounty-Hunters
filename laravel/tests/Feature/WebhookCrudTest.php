<?php

namespace Tests\Feature;

use App\Models\Webhook;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class WebhookCrudTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('app.key', 'base64:'.base64_encode(random_bytes(32)));
    }

    public function test_webhooks_can_be_created_listed_updated_and_deleted(): void
    {
        $createResponse = $this->postJson('/webhooks', [
            'url' => 'https://example.test/webhook',
            'secret' => 'secret-value',
            'events' => ['user.created', 'invoice.paid'],
        ]);

        $createResponse
            ->assertCreated()
            ->assertJsonPath('data.url', 'https://example.test/webhook')
            ->assertJsonPath('data.active', true);

        $webhookId = $createResponse->json('data.id');

        $this->assertDatabaseHas('webhooks', [
            'id' => $webhookId,
            'url' => 'https://example.test/webhook',
            'active' => true,
        ]);

        $this->getJson('/webhooks')
            ->assertOk()
            ->assertJsonPath('data.0.id', $webhookId)
            ->assertJsonPath('data.0.deliveries_count', 0);

        $this->putJson("/webhooks/{$webhookId}", [
            'active' => false,
            'events' => ['invoice.paid'],
        ])
            ->assertOk()
            ->assertJsonPath('data.active', false)
            ->assertJsonPath('data.events.0', 'invoice.paid');

        $this->deleteJson("/webhooks/{$webhookId}")
            ->assertNoContent();

        $this->assertDatabaseMissing('webhooks', [
            'id' => $webhookId,
        ]);
    }

    public function test_webhook_show_includes_delivery_history(): void
    {
        $webhook = Webhook::query()->create([
            'url' => 'https://example.test/webhook',
            'secret' => 'secret-value',
            'events' => ['user.created'],
        ]);

        $webhook->deliveries()->create([
            'event' => 'user.created',
            'payload' => ['id' => 1],
            'response_code' => 200,
            'attempts' => 1,
            'delivered_at' => now(),
        ]);

        $this->getJson("/webhooks/{$webhook->id}")
            ->assertOk()
            ->assertJsonPath('data.id', $webhook->id)
            ->assertJsonPath('data.deliveries.0.event', 'user.created')
            ->assertJsonPath('data.deliveries.0.response_code', 200);
    }
}
