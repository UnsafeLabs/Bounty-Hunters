<?php

namespace Tests\Feature;

use App\Models\Webhook;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class WebhookControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_creates_a_webhook(): void
    {
        $response = $this->postJson('/api/webhooks', [
            'url' => 'https://example.test/hook',
            'secret' => 'shh',
            'events' => ['order.created', 'order.updated'],
            'active' => true,
        ]);

        $response->assertCreated()
            ->assertJsonPath('url', 'https://example.test/hook')
            ->assertJsonPath('events', ['order.created', 'order.updated']);

        $this->assertDatabaseHas('webhooks', ['url' => 'https://example.test/hook']);
    }

    public function test_it_validates_required_fields_on_create(): void
    {
        $this->postJson('/api/webhooks', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['url', 'secret', 'events']);
    }

    public function test_it_lists_webhooks(): void
    {
        Webhook::create([
            'url' => 'https://example.test/a',
            'secret' => 'a',
            'events' => ['ping'],
        ]);

        $this->getJson('/api/webhooks')
            ->assertOk()
            ->assertJsonCount(1);
    }

    public function test_it_updates_a_webhook(): void
    {
        $webhook = Webhook::create([
            'url' => 'https://example.test/a',
            'secret' => 'a',
            'events' => ['ping'],
            'active' => true,
        ]);

        $this->putJson("/api/webhooks/{$webhook->id}", ['active' => false])
            ->assertOk()
            ->assertJsonPath('active', false);

        $this->assertFalse($webhook->fresh()->active);
    }

    public function test_it_deletes_a_webhook(): void
    {
        $webhook = Webhook::create([
            'url' => 'https://example.test/a',
            'secret' => 'a',
            'events' => ['ping'],
        ]);

        $this->deleteJson("/api/webhooks/{$webhook->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('webhooks', ['id' => $webhook->id]);
    }

    public function test_a_webhook_has_many_deliveries(): void
    {
        $webhook = Webhook::create([
            'url' => 'https://example.test/a',
            'secret' => 'a',
            'events' => ['ping'],
        ]);

        $delivery = $webhook->deliveries()->create([
            'event' => 'ping',
            'payload' => ['hello' => 'world'],
            'attempts' => 0,
        ]);

        $this->assertTrue($webhook->deliveries->contains($delivery));
        $this->assertTrue($delivery->webhook->is($webhook));
    }
}
