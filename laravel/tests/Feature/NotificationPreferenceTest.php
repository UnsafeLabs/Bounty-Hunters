<?php

namespace Tests\Feature;

use App\Models\NotificationPreference;
use App\Models\User;
use App\Services\NotificationRouter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationPreferenceTest extends TestCase
{
    use RefreshDatabase;

    public function test_new_users_get_default_preferences_and_can_list_them(): void
    {
        $user = User::factory()->create();

        $this->assertDatabaseCount('notification_preferences', 9);

        $this->actingAs($user)
            ->get('/notifications/preferences')
            ->assertOk()
            ->assertJsonCount(9, 'data')
            ->assertJsonPath('data.0.enabled', true);
    }

    public function test_user_can_toggle_own_preference(): void
    {
        $user = User::factory()->create();
        $preference = $user->notificationPreferences()
            ->where('event_type', 'comment.created')
            ->where('channel', 'slack')
            ->firstOrFail();

        $this->actingAs($user)
            ->put("/notifications/preferences/{$preference->id}", ['enabled' => false])
            ->assertOk()
            ->assertJsonPath('data.enabled', false);

        $this->assertDatabaseHas('notification_preferences', [
            'id' => $preference->id,
            'enabled' => false,
        ]);
    }

    public function test_bulk_update_toggles_multiple_preferences_and_rejects_other_users_preferences(): void
    {
        $user = User::factory()->create();
        $otherUser = User::factory()->create();
        $preferences = $user->notificationPreferences()->limit(2)->get();
        $otherPreference = $otherUser->notificationPreferences()->firstOrFail();

        $this->actingAs($user)
            ->post('/notifications/preferences/bulk', [
                'preferences' => $preferences->map(fn (NotificationPreference $preference) => [
                    'id' => $preference->id,
                    'enabled' => false,
                ])->all(),
            ])
            ->assertOk()
            ->assertJsonCount(2, 'data');

        foreach ($preferences as $preference) {
            $this->assertDatabaseHas('notification_preferences', [
                'id' => $preference->id,
                'enabled' => false,
            ]);
        }

        $this->actingAs($user)
            ->post('/notifications/preferences/bulk', [
                'preferences' => [
                    ['id' => $otherPreference->id, 'enabled' => false],
                ],
            ])
            ->assertForbidden();
    }

    public function test_unique_constraint_prevents_duplicate_preferences(): void
    {
        $user = User::factory()->create();

        $this->expectException(\Illuminate\Database\UniqueConstraintViolationException::class);

        NotificationPreference::create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'comment.created',
            'enabled' => true,
        ]);
    }

    public function test_router_filters_disabled_channels_before_dispatch(): void
    {
        $user = User::factory()->create();

        $user->notificationPreferences()
            ->where('event_type', 'comment.created')
            ->where('channel', 'slack')
            ->update(['enabled' => false]);

        $sent = [];
        $router = new NotificationRouter();

        $channels = $router->dispatch(
            $user,
            'comment.created',
            ['mail', 'slack', 'database'],
            function (string $channel) use (&$sent): void {
                $sent[] = $channel;
            }
        );

        $this->assertSame(['mail', 'database'], $channels);
        $this->assertSame(['mail', 'database'], $sent);
    }
}
