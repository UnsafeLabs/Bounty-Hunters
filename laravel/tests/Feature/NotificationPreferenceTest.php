<?php

namespace Tests\Feature;

use App\Models\NotificationPreference;
use App\Models\User;
use App\Notifications\RoutedNotification;
use App\Services\NotificationRouter;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\Notification as NotificationFacade;
use Tests\TestCase;

class NotificationPreferenceTest extends TestCase
{
    use RefreshDatabase;

    public function test_new_users_receive_default_notification_preferences(): void
    {
        $user = User::factory()->create();

        $this->assertCount(9, $user->notificationPreferences);
        $this->assertTrue(
            $user->notificationPreferences
                ->where('event_type', 'security.alert')
                ->where('channel', 'mail')
                ->first()
                ->enabled
        );
    }

    public function test_users_can_list_their_notification_preferences(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)
            ->getJson('/notifications/preferences');

        $response->assertOk()
            ->assertJsonCount(9, 'data')
            ->assertJsonPath('data.0.event_type', 'account.updated');
    }

    public function test_users_can_update_one_notification_preference(): void
    {
        $user = User::factory()->create();
        $preference = $user->notificationPreferences()->first();

        $response = $this->actingAs($user)
            ->putJson("/notifications/preferences/{$preference->id}", [
                'enabled' => false,
            ]);

        $response->assertOk()
            ->assertJsonPath('data.enabled', false);

        $this->assertFalse($preference->refresh()->enabled);
    }

    public function test_users_cannot_update_another_users_preference(): void
    {
        $user = User::factory()->create();
        $otherUser = User::factory()->create();
        $preference = $otherUser->notificationPreferences()->first();

        $this->actingAs($user)
            ->putJson("/notifications/preferences/{$preference->id}", [
                'enabled' => false,
            ])
            ->assertNotFound();
    }

    public function test_users_can_bulk_update_their_notification_preferences(): void
    {
        $user = User::factory()->create();
        $preferences = $user->notificationPreferences()->take(2)->get();

        $response = $this->actingAs($user)
            ->postJson('/notifications/preferences/bulk', [
                'preferences' => $preferences->map(fn (NotificationPreference $preference): array => [
                    'id' => $preference->id,
                    'enabled' => false,
                ])->all(),
            ]);

        $response->assertOk()
            ->assertJsonCount(9, 'data');

        $this->assertSame(0, NotificationPreference::query()
            ->whereIn('id', $preferences->pluck('id'))
            ->where('enabled', true)
            ->count());
    }

    public function test_notification_router_filters_disabled_channels(): void
    {
        $user = User::factory()->create();

        $user->notificationPreferences()
            ->where('event_type', 'security.alert')
            ->where('channel', 'mail')
            ->update(['enabled' => false]);

        $channels = app(NotificationRouter::class)->enabledChannels(
            $user,
            'security.alert',
            ['mail', 'slack', 'database']
        );

        $this->assertSame(['slack', 'database'], $channels);
        $this->assertFalse(app(NotificationRouter::class)->shouldSend($user, 'security.alert', 'mail'));
        $this->assertTrue(app(NotificationRouter::class)->shouldSend($user, 'security.alert', 'slack'));
    }

    public function test_notification_router_sends_only_to_enabled_channels(): void
    {
        NotificationFacade::fake();

        $user = User::factory()->create();
        $user->notificationPreferences()
            ->where('event_type', 'security.alert')
            ->where('channel', 'mail')
            ->update(['enabled' => false]);

        $usedChannels = app(NotificationRouter::class)->send(
            $user,
            'security.alert',
            new class extends Notification
            {
                /**
                 * @return array<int, string>
                 */
                public function via(object $notifiable): array
                {
                    return ['mail', 'slack', 'database'];
                }
            }
        );

        $this->assertSame(['slack', 'database'], $usedChannels);

        NotificationFacade::assertSentTo(
            $user,
            RoutedNotification::class,
            fn (RoutedNotification $notification): bool => $notification->via($user) === ['slack', 'database']
        );
    }

    public function test_duplicate_notification_preferences_are_rejected(): void
    {
        $this->expectException(QueryException::class);

        $user = User::factory()->create();
        NotificationPreference::query()->create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'security.alert',
            'enabled' => true,
        ]);
    }
}
