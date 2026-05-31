<?php

namespace Tests\Feature;

use App\Models\NotificationPreference;
use App\Models\User;
use App\Services\NotificationRouter;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\Notification as NotificationFacade;
use Tests\TestCase;

class NotificationPreferenceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('app.key', 'base64:'.base64_encode(random_bytes(32)));
    }

    public function test_new_users_receive_default_preferences(): void
    {
        $user = User::factory()->create();

        $this->assertSame(
            count(NotificationPreference::CHANNELS) * count(NotificationPreference::DEFAULT_EVENT_TYPES),
            $user->notificationPreferences()->count()
        );
        $this->assertDatabaseHas('notification_preferences', [
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'account.created',
            'enabled' => true,
        ]);
    }

    public function test_user_can_list_notification_preferences(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->getJson('/notifications/preferences')
            ->assertOk()
            ->assertJsonCount(9, 'data')
            ->assertJsonPath('data.0.channel', 'database')
            ->assertJsonPath('data.0.event_type', 'account.created');
    }

    public function test_user_can_toggle_an_individual_preference(): void
    {
        $user = User::factory()->create();
        $preference = $user->notificationPreferences()
            ->where('channel', 'mail')
            ->where('event_type', 'security.alert')
            ->firstOrFail();

        $this->actingAs($user)
            ->putJson("/notifications/preferences/{$preference->id}", [
                'enabled' => false,
            ])
            ->assertOk()
            ->assertJsonPath('data.enabled', false);

        $this->assertDatabaseHas('notification_preferences', [
            'id' => $preference->id,
            'enabled' => false,
        ]);
    }

    public function test_bulk_update_toggles_multiple_preferences(): void
    {
        $user = User::factory()->create();
        $preferences = $user->notificationPreferences()
            ->where('event_type', 'billing.updated')
            ->orderBy('id')
            ->take(2)
            ->get();

        $this->actingAs($user)
            ->postJson('/notifications/preferences/bulk', [
                'preferences' => [
                    ['id' => $preferences[0]->id, 'enabled' => false],
                    ['id' => $preferences[1]->id, 'enabled' => true],
                ],
            ])
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.enabled', false)
            ->assertJsonPath('data.1.enabled', true);

        $this->assertFalse($preferences[0]->refresh()->enabled);
        $this->assertTrue($preferences[1]->refresh()->enabled);
    }

    public function test_notification_router_only_uses_enabled_channels(): void
    {
        NotificationFacade::fake();

        $user = User::factory()->create();
        $user->notificationPreferences()
            ->where('event_type', 'security.alert')
            ->where('channel', 'slack')
            ->update(['enabled' => false]);

        $router = app(NotificationRouter::class);
        $notification = new class extends Notification {};

        $channels = $router->send($user, 'security.alert', $notification);

        $this->assertSame(['database', 'mail'], $channels);
        $this->assertTrue($router->shouldSend($user, 'security.alert', 'mail'));
        $this->assertFalse($router->shouldSend($user, 'security.alert', 'slack'));
        NotificationFacade::assertSentTo($user, get_class($notification));
    }

    public function test_unique_constraint_prevents_duplicate_preference_entries(): void
    {
        $this->expectException(QueryException::class);

        $user = User::factory()->create();

        NotificationPreference::query()->create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'account.created',
            'enabled' => true,
        ]);
    }
}
