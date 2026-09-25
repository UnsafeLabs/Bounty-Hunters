<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\NotificationPreference;
use App\Services\NotificationRouter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationPreferenceTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_view_preferences()
    {
        $user = User::factory()->create();
        NotificationPreference::factory()->create([
            'user_id'   => $user->id,
            'channel'   => 'mail',
            'event_type'=> 'order_created',
            'enabled'   => true,
        ]);

        $this->actingAs($user, 'sanctum')
            ->getJson('/api/notifications/preferences')
            ->assertStatus(200)
            ->assertJsonFragment(['channel' => 'mail']);
    }

    public function test_user_can_update_preference()
    {
        $user = User::factory()->create();
        $pref = NotificationPreference::factory()->create([
            'user_id'   => $user->id,
            'channel'   => 'mail',
            'event_type'=> 'order_created',
            'enabled'   => true,
        ]);

        $this->actingAs($user, 'sanctum')
            ->putJson("/api/notifications/preferences/{$pref->id}", ['enabled' => false])
            ->assertStatus(200)
            ->assertJsonFragment(['enabled' => false]);

        $this->assertDatabaseHas('notification_preferences', [
            'id'      => $pref->id,
            'enabled' => false,
        ]);
    }

    public function test_user_can_bulk_update_preferences()
    {
        $user = User::factory()->create();
        $pref1 = NotificationPreference::factory()->create([
            'user_id'   => $user->id,
            'channel'   => 'mail',
            'event_type'=> 'order_created',
            'enabled'   => true,
        ]);
        $pref2 = NotificationPreference::factory()->create([
            'user_id'   => $user->id,
            'channel'   => 'slack',
            'event_type'=> 'order_created',
            'enabled'   => true,
        ]);

        $payload = [
            ['id' => $pref1->id, 'enabled' => false],
            ['id' => $pref2->id, 'enabled' => false],
        ];

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/notifications/preferences/bulk', ['preferences' => $payload])
            ->assertStatus(200)
            ->assertJson(['status' => 'success']);

        $this->assertDatabaseHas('notification_preferences', [
            'id'      => $pref1->id,
            'enabled' => false,
        ]);
        $this->assertDatabaseHas('notification_preferences', [
            'id'      => $pref2->id,
            'enabled' => false,
        ]);
    }

    public function test_notification_router_filters_channels()
    {
        $user = User::factory()->create();
        NotificationPreference::factory()->create([
            'user_id'   => $user->id,
            'channel'   => 'mail',
            'event_type'=> 'order_created',
            'enabled'   => true,
        ]);
        NotificationPreference::factory()->create([
            'user_id'   => $user->id,
            'channel'   => 'slack',
            'event_type'=> 'order_created',
            'enabled'   => false,
        ]);

        $router = new NotificationRouter();
        $channels = $router->getEnabledChannels($user, 'order_created');

        $this->assertEquals(['mail'], $channels);
    }
}
