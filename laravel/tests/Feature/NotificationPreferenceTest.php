<?php

namespace Tests\Feature;

use App\Models\NotificationPreference;
use App\Models\User;
use App\Services\NotificationRouter;
use Illuminate\Foundation\Testing\TestCase;

class NotificationPreferenceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware();
    }

    public function test_list_preferences_for_user(): void
    {
        $user = User::factory()->create();

        NotificationPreference::create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'order.created',
            'enabled' => true,
        ]);

        NotificationPreference::create([
            'user_id' => $user->id,
            'channel' => 'slack',
            'event_type' => 'order.created',
            'enabled' => false,
        ]);

        $response = $this->actingAs($user)->getJson('/api/notifications/preferences');

        $response->assertStatus(200);
        $this->assertCount(2, $response->json());
    }

    public function test_update_preference(): void
    {
        $user = User::factory()->create();

        $pref = NotificationPreference::create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'order.created',
            'enabled' => true,
        ]);

        $response = $this->actingAs($user)->putJson("/api/notifications/preferences/{$pref->id}", [
            'enabled' => false,
        ]);

        $response->assertStatus(200);
        $this->assertFalse($response->json('enabled'));
    }

    public function test_bulk_update_preferences(): void
    {
        $user = User::factory()->create();

        $pref1 = NotificationPreference::create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'order.created',
            'enabled' => true,
        ]);

        $pref2 = NotificationPreference::create([
            'user_id' => $user->id,
            'channel' => 'slack',
            'event_type' => 'order.shipped',
            'enabled' => true,
        ]);

        $response = $this->actingAs($user)->postJson('/api/notifications/preferences/bulk', [
            'preferences' => [
                ['id' => $pref1->id, 'enabled' => false],
                ['id' => $pref2->id, 'enabled' => false],
            ],
        ]);

        $response->assertStatus(200);
        $this->assertCount(2, $response->json());
    }

    public function test_router_sends_to_enabled_channels_only(): void
    {
        $user = User::factory()->create();

        NotificationPreference::create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'test.event',
            'enabled' => true,
        ]);

        NotificationPreference::create([
            'user_id' => $user->id,
            'channel' => 'slack',
            'event_type' => 'test.event',
            'enabled' => false,
        ]);

        $router = new NotificationRouter();
        $result = $router->route($user->id, 'test.event', ['mail', 'slack'], fn($ch) => 'sent');

        $this->assertEquals('sent', $result['mail']);
        $this->assertEquals('skipped', $result['slack']);
    }

    public function test_router_returns_enabled_channels(): void
    {
        $user = User::factory()->create();

        NotificationPreference::create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'test.event',
            'enabled' => true,
        ]);

        NotificationPreference::create([
            'user_id' => $user->id,
            'channel' => 'database',
            'event_type' => 'test.event',
            'enabled' => true,
        ]);

        $router = new NotificationRouter();
        $channels = $router->getEnabledChannels($user->id, 'test.event');

        $this->assertCount(2, $channels);
        $this->assertContains('mail', $channels);
        $this->assertContains('database', $channels);
    }

    public function test_unique_constraint_prevents_duplicates(): void
    {
        $user = User::factory()->create();

        NotificationPreference::create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'order.created',
            'enabled' => true,
        ]);

        $this->expectException(\Illuminate\Database\QueryException::class);
        NotificationPreference::create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'order.created',
            'enabled' => false,
        ]);
    }
}
