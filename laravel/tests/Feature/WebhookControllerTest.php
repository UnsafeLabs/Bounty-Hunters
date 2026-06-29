<?php

namespace Tests\Feature;

use App\Models\Webhook;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\WithoutMiddleware;
use Tests\TestCase;

class WebhookControllerTest extends TestCase
{
    use RefreshDatabase, WithoutMiddleware;

    public function test_webhooks_can_be_created_listed_updated_and_deleted(): void
    {
        $createResponse = $this->postJson('/webhooks', [
            'url' => 'https://example.com/webhooks',
            'secret' => 'a-very-secret-value',
            'events' => ['user.created'],
            'active' => true,
        ]);

        $createResponse
            ->assertCreated()
            ->assertJsonPath('url', 'https://example.com/webhooks')
            ->assertJsonMissing(['secret' => 'a-very-secret-value']);

        $webhookId = $createResponse->json('id');

        $this->getJson('/webhooks')
            ->assertOk()
            ->assertJsonPath('data.0.id', $webhookId);

        $this->patchJson("/webhooks/{$webhookId}", [
            'events' => ['user.created', 'user.deleted'],
            'active' => false,
        ])
            ->assertOk()
            ->assertJsonPath('active', false);

        $this->deleteJson("/webhooks/{$webhookId}")
            ->assertNoContent();

        $this->assertDatabaseMissing('webhooks', ['id' => $webhookId]);
    }

    public function test_webhook_model_matches_wildcard_or_specific_events(): void
    {
        $webhook = new Webhook([
            'events' => ['user.created'],
        ]);

        $this->assertTrue($webhook->listensFor('user.created'));
        $this->assertFalse($webhook->listensFor('user.deleted'));

        $wildcard = new Webhook([
            'events' => ['*'],
        ]);

        $this->assertTrue($wildcard->listensFor('anything.happened'));
    }
}
