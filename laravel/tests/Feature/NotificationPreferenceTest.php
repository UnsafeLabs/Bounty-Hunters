<?php

namespace Tests\Feature;

use App\Models\NotificationPreference;
use App\Models\User;
use App\Services\NotificationRouter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\Notification as NotificationFacade;
use Illuminate\Support\Str;
use Tests\TestCase;

class NotificationPreferenceTest extends TestCase
{
    use RefreshDatabase;

    public function test_new_users_receive_default_notification_preferences(): void
    {
        $user = User::factory()->create();

        $this->assertDatabaseCount('notification_preferences', 9);
        $this->assertSame(9, $user->notificationPreferences()->count());
    }

    public function test_user_can_list_notification_preferences(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->getJson('/notifications/preferences');

        $response->assertOk()
            ->assertJsonCount(9, 'data')
            ->assertJsonPath('data.0.enabled', true);
    }

    public function test_user_can_update_single_notification_preference(): void
    {
        $user = User::factory()->create();
        $preference = $user->notificationPreferences()->firstOrFail();

        $response = $this->actingAs($user)->putJson("/notifications/preferences/{$preference->id}", [
            'enabled' => false,
        ]);

        $response->assertOk()
            ->assertJsonPath('data.id', $preference->id)
            ->assertJsonPath('data.enabled', false);

        $this->assertFalse($preference->fresh()->enabled);
    }

    public function test_user_cannot_update_another_users_preference(): void
    {
        $user = User::factory()->create();
        $otherUser = User::factory()->create();
        $preference = $otherUser->notificationPreferences()->firstOrFail();

        $this->actingAs($user)
            ->putJson("/notifications/preferences/{$preference->id}", ['enabled' => false])
            ->assertNotFound();
    }

    public function test_user_can_bulk_update_notification_preferences(): void
    {
        $user = User::factory()->create();
        $preferences = $user->notificationPreferences()->limit(2)->get();

        $response = $this->actingAs($user)->postJson('/notifications/preferences/bulk', [
            'preferences' => $preferences->map(fn (NotificationPreference $preference): array => [
                'id' => $preference->id,
                'enabled' => false,
            ])->all(),
        ]);

        $response->assertOk()->assertJsonCount(2, 'data');

        $this->assertSame(0, NotificationPreference::whereIn('id', $preferences->pluck('id'))->where('enabled', true)->count());
    }

    public function test_notification_router_filters_disabled_channels(): void
    {
        NotificationFacade::fake();

        $user = User::factory()->create();
        $eventType = 'security.alert';

        $user->notificationPreferences()
            ->where('event_type', $eventType)
            ->where('channel', 'slack')
            ->firstOrFail()
            ->update(['enabled' => false]);

        app(NotificationRouter::class)->route($user, new RoutedTestNotification(), $eventType);

        NotificationFacade::assertSentTo(
            $user,
            RoutedTestNotification::class,
            fn (RoutedTestNotification $notification, array $channels): bool => $channels === ['mail', 'database'],
        );
    }

    public function test_unique_constraint_prevents_duplicate_preference_entries(): void
    {
        $user = User::factory()->create();
        $existing = $user->notificationPreferences()->firstOrFail();

        $this->expectException(\Illuminate\Database\UniqueConstraintViolationException::class);

        NotificationPreference::create([
            'user_id' => $user->id,
            'channel' => $existing->channel,
            'event_type' => $existing->event_type,
            'enabled' => true,
        ]);
    }
}

class RoutedTestNotification extends Notification
{
    public function via(object $notifiable): array
    {
        return ['mail', 'slack', 'database'];
    }

    public function toArray(object $notifiable): array
    {
        return ['id' => Str::uuid()->toString()];
    }
}
