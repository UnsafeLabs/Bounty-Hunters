<?php

namespace Tests\Feature;

use App\Models\NotificationPreference;
use App\Models\User;
use App\Services\NotificationRouter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\WithoutMiddleware;
use Tests\TestCase;

class NotificationPreferenceTest extends TestCase
{
    use RefreshDatabase, WithoutMiddleware;

    public function test_new_users_get_default_notification_preferences(): void
    {
        $user = User::factory()->create();

        $this->assertDatabaseCount(
            'notification_preferences',
            count(NotificationRouter::DEFAULT_EVENT_TYPES) * count(NotificationPreference::CHANNELS)
        );

        foreach (NotificationRouter::DEFAULT_EVENT_TYPES as $eventType) {
            foreach (NotificationPreference::CHANNELS as $channel) {
                $this->assertDatabaseHas('notification_preferences', [
                    'user_id' => $user->id,
                    'event_type' => $eventType,
                    'channel' => $channel,
                ]);
            }
        }
    }

    public function test_user_can_list_and_update_preferences(): void
    {
        $user = User::factory()->create();
        $preference = $user->notificationPreferences()
            ->where('channel', NotificationPreference::CHANNEL_MAIL)
            ->where('event_type', 'account.created')
            ->firstOrFail();

        $this->actingAs($user)
            ->getJson('/notifications/preferences')
            ->assertOk()
            ->assertJsonFragment([
                'id' => $preference->id,
                'channel' => NotificationPreference::CHANNEL_MAIL,
                'event_type' => 'account.created',
            ]);

        $this->actingAs($user)
            ->putJson("/notifications/preferences/{$preference->id}", [
                'enabled' => false,
            ])
            ->assertOk()
            ->assertJsonPath('enabled', false);

        $this->assertDatabaseHas('notification_preferences', [
            'id' => $preference->id,
            'enabled' => false,
        ]);
    }

    public function test_bulk_update_toggles_multiple_preferences(): void
    {
        $user = User::factory()->create();
        $preferences = $user->notificationPreferences()
            ->where('event_type', 'security.alert')
            ->orderBy('channel')
            ->take(2)
            ->get();

        $this->actingAs($user)
            ->postJson('/notifications/preferences/bulk', [
                'preferences' => $preferences->map(fn (NotificationPreference $preference): array => [
                    'id' => $preference->id,
                    'enabled' => false,
                ])->all(),
            ])
            ->assertOk();

        foreach ($preferences as $preference) {
            $this->assertDatabaseHas('notification_preferences', [
                'id' => $preference->id,
                'enabled' => false,
            ]);
        }
    }

    public function test_notification_router_filters_disabled_channels(): void
    {
        $user = User::factory()->create();

        $user->notificationPreferences()
            ->where('event_type', 'account.created')
            ->where('channel', NotificationPreference::CHANNEL_MAIL)
            ->update(['enabled' => false]);

        $sent = [];
        $channels = (new NotificationRouter)->dispatch(
            $user,
            'account.created',
            NotificationPreference::CHANNELS,
            function (string $channel) use (&$sent): void {
                $sent[] = $channel;
            }
        );

        $this->assertNotContains(NotificationPreference::CHANNEL_MAIL, $channels);
        $this->assertNotContains(NotificationPreference::CHANNEL_MAIL, $sent);
        $this->assertContains(NotificationPreference::CHANNEL_DATABASE, $channels);
        $this->assertContains(NotificationPreference::CHANNEL_DATABASE, $sent);
    }
}
