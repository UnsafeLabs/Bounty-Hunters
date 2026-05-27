<?php

namespace Tests\Feature;

use App\Models\Webhook;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class WebhookControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_webhook_can_be_created_and_listed(): void
    {
        $payload = [
            'url' => 'https://example.com/webhooks/orders',
            'secret' => 'super-secret-signing-key',
            'events' => ['order.created', 'order.updated'],
            'active' => true,
        ];

        $this->postJson('/api/webhooks', $payload)
            ->assertCreated()
            ->assertJsonPath('data.url', $payload['url'])
            ->assertJsonPath('data.events.0', 'order.created');

        $this->getJson('/api/webhooks')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.active', true);

        $this->assertDatabaseHas('webhooks', [
            'url' => $payload['url'],
            'active' => true,
        ]);
    }

    public function test_webhook_can_be_updated_and_deleted(): void
    {
        $webhook = Webhook::query()->create([
            'url' => 'https://example.com/old',
            'secret' => 'super-secret-signing-key',
            'events' => ['order.created'],
            'active' => true,
        ]);

        $this->patchJson("/api/webhooks/{$webhook->id}", [
            'active' => false,
            'events' => ['order.cancelled'],
        ])
            ->assertOk()
            ->assertJsonPath('data.active', false)
            ->assertJsonPath('data.events.0', 'order.cancelled');

        $this->deleteJson("/api/webhooks/{$webhook->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('webhooks', [
            'id' => $webhook->id,
        ]);
    }

    public function test_webhook_validation_rejects_bad_input(): void
    {
        $this->postJson('/api/webhooks', [
            'url' => 'not-a-url',
            'secret' => 'short',
            'events' => [],
        ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['url', 'secret', 'events']);
    }
}
