<?php

namespace Tests\Feature;

use App\Models\NotificationPreference;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationPreferenceTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_list_preferences(): void
    {
        $user = User::factory()->create();
        NotificationPreference::create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'order.created',
            'enabled' => true,
        ]);

        $response = $this->actingAs($user)
            ->getJson('/api/notifications/preferences');

        $response->assertOk();
        $response->assertJsonStructure(['preferences']);
    }

    public function test_user_can_update_preference(): void
    {
        $user = User::factory()->create();
        $pref = NotificationPreference::create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'order.created',
            'enabled' => true,
        ]);

        $response = $this->actingAs($user)
            ->putJson("/api/notifications/preferences/{$pref->id}", [
                'enabled' => false,
            ]);

        $response->assertOk();
        $this->assertFalse($pref->fresh()->enabled);
    }

    public function test_user_can_bulk_update_preferences(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)
            ->postJson('/api/notifications/preferences/bulk', [
                'preferences' => [
                    ['channel' => 'mail', 'event_type' => 'order.created', 'enabled' => false],
                    ['channel' => 'slack', 'event_type' => 'order.shipped', 'enabled' => true],
                ],
            ]);

        $response->assertOk();
        $this->assertDatabaseHas('notification_preferences', [
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'order.created',
            'enabled' => false,
        ]);
    }

    public function test_user_cannot_update_others_preference(): void
    {
        $user1 = User::factory()->create();
        $user2 = User::factory()->create();
        $pref = NotificationPreference::create([
            'user_id' => $user1->id,
            'channel' => 'mail',
            'event_type' => 'order.created',
            'enabled' => true,
        ]);

        $response = $this->actingAs($user2)
            ->putJson("/api/notifications/preferences/{$pref->id}", [
                'enabled' => false,
            ]);

        $response->assertForbidden();
    }

    public function test_unique_constraint_on_user_channel_event(): void
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
