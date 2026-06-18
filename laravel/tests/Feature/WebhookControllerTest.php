<?php

namespace Tests\Feature;

use App\Models\Webhook;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class WebhookControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_webhook_crud_endpoints(): void
    {
        $create = $this->postJson('/api/webhooks', [
            'url' => 'https://example.test/hooks',
            'secret' => 'top-secret',
            'events' => ['user.created'],
            'active' => true,
        ])->assertCreated();

        $id = $create->json('id');

        $this->assertDatabaseHas('webhooks', [
            'id' => $id,
            'url' => 'https://example.test/hooks',
            'active' => true,
        ]);

        $this->getJson('/api/webhooks')
            ->assertOk()
            ->assertJsonFragment(['url' => 'https://example.test/hooks']);

        $this->patchJson("/api/webhooks/{$id}", [
            'url' => 'https://example.test/updated',
            'events' => ['invoice.paid'],
            'active' => false,
        ])->assertOk()
            ->assertJsonPath('url', 'https://example.test/updated')
            ->assertJsonPath('active', false);

        $this->deleteJson("/api/webhooks/{$id}")->assertNoContent();

        $this->assertDatabaseMissing('webhooks', ['id' => $id]);
    }

    public function test_show_endpoint_includes_delivery_history(): void
    {
        $webhook = Webhook::query()->create([
            'url' => 'https://example.test/hooks',
            'secret' => 'top-secret',
            'events' => ['user.created'],
            'active' => true,
        ]);

        $webhook->deliveries()->create([
            'event' => 'user.created',
            'payload' => ['id' => 123],
            'attempts' => 1,
            'response_code' => 204,
            'delivered_at' => now(),
        ]);

        $this->getJson("/api/webhooks/{$webhook->id}")
            ->assertOk()
            ->assertJsonPath('deliveries.0.event', 'user.created')
            ->assertJsonPath('deliveries.0.response_code', 204);
    }
}
