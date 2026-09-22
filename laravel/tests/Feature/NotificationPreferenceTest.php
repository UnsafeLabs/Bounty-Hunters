<?php

namespace Tests\Feature;

use App\Models\NotificationPreference;
use App\Models\User;
use App\Services\NotificationRouter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\Notification;
use Tests\TestCase;

class NotificationPreferenceTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
    }

    public function test_can_list_notification_preferences(): void
    {
        NotificationPreference::factory()->count(5)->create([
            'user_id' => $this->user->id,
        ]);

        $response = $this->actingAs($this->user)
            ->getJson('/notifications/preferences');

        $response->assertOk()
            ->assertJsonCount(5);
    }

    public function test_can_update_single_preference(): void
    {
        $preference = NotificationPreference::factory()->create([
            'user_id' => $this->user->id,
            'enabled' => true,
        ]);

        $response = $this->actingAs($this->user)
            ->putJson("/notifications/preferences/{$preference->id}", [
                'enabled' => false,
            ]);

        $response->assertOk()
            ->assertJsonFragment(['enabled' => false]);

        $this->assertDatabaseHas('notification_preferences', [
            'id' => $preference->id,
            'enabled' => false,
        ]);
    }

    public function test_cannot_update_another_users_preference(): void
    {
        $otherUser = User::factory()->create();
        $preference = NotificationPreference::factory()->create([
            'user_id' => $otherUser->id,
            'enabled' => true,
        ]);

        $response = $this->actingAs($this->user)
            ->putJson("/notifications/preferences/{$preference->id}", [
                'enabled' => false,
            ]);

        $response->assertForbidden();
    }

    public function test_can_bulk_update_preferences(): void
    {
        $preferences = NotificationPreference::factory()->count(3)->create([
            'user_id' => $this->user->id,
            'enabled' => true,
        ]);

        $payload = [
            'preferences' => $preferences->map(fn ($p) => [
                'id' => $p->id,
                'enabled' => false,
            ])->toArray(),
        ];

        $response = $this->actingAs($this->user)
            ->postJson('/notifications/preferences/bulk', $payload);

        $response->assertOk()
            ->assertJsonCount(3);

        foreach ($preferences as $preference) {
            $this->assertDatabaseHas('notification_preferences', [
                'id' => $preference->id,
                'enabled' => false,
            ]);
        }
    }

    public function test_bulk_update_ignores_other_users_preferences(): void
    {
        $otherUser = User::factory()->create();
        $otherPreference = NotificationPreference::factory()->create([
            'user_id' => $otherUser->id,
            'enabled' => true,
        ]);

        $myPreference = NotificationPreference::factory()->create([
            'user_id' => $this->user->id,
            'enabled' => true,
        ]);

        $payload = [
            'preferences' => [
                ['id' => $myPreference->id, 'enabled' => false],
                ['id' => $otherPreference->id, 'enabled' => false],
            ],
        ];

        $response = $this->actingAs($this->user)
            ->postJson('/notifications/preferences/bulk', $payload);

        $response->assertOk();

        $this->assertDatabaseHas('notification_preferences', [
            'id' => $myPreference->id,
            'enabled' => false,
        ]);

        $this->assertDatabaseHas('notification_preferences', [
            'id' => $otherPreference->id,
            'enabled' => true,
        ]);
    }

    public function test_unique_constraint_prevents_duplicate_preferences(): void
    {
        NotificationPreference::create([
            'user_id' => $this->user->id,
            'channel' => 'mail',
            'event_type' => 'order_created',
            'enabled' => true,
        ]);

        $this->expectException(\Illuminate\Database\QueryException::class);

        NotificationPreference::create([
            'user_id' => $this->user->id,
            'channel' => 'mail',
            'event_type' => 'order_created',
            'enabled' => false,
        ]);
    }
}

class NotificationRouterTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;
    protected NotificationRouter $router;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->router = new NotificationRouter();
    }

    public function test_get_enabled_channels_returns_only_enabled_channels(): void
    {
        NotificationPreference::factory()->create([
            'user_id' => $this->user->id,
            'channel' => 'mail',
            'event_type' => 'order_created',
            'enabled' => true,
        ]);

        NotificationPreference::factory()->create([
            'user_id' => $this->user->id,
            'channel' => 'slack',
            'event_type' => 'order_created',
            'enabled' => false,
        ]);

        NotificationPreference::factory()->create([
            'user_id' => $this->user->id,
            'channel' => 'database',
            'event_type' => 'order_created',
            'enabled' => true,
        ]);

        $enabledChannels = $this->router->getEnabledChannels($this->user, 'order_created');

        $this->assertEquals(['mail', 'database'], $enabledChannels);
    }

    public function test_is_channel_enabled_returns_true_for_enabled_channel(): void
    {
        NotificationPreference::factory()->create([
            'user_id' => $this->user->id,
            'channel' => 'mail',
            'event_type' => 'order_created',
            'enabled' => true,
        ]);

        $result = $this->router->isChannelEnabled($this->user, 'order_created', 'mail');

        $this->assertTrue($result);
    }

    public function test_is_channel_enabled_returns_false_for_disabled_channel(): void
    {
        NotificationPreference::factory()->create([
            'user_id' => $this->user->id,
            'channel' => 'slack',
            'event_type' => 'order_created',
            'enabled' => false,
        ]);

        $result = $this->router->isChannelEnabled($this->user, 'order_created', 'slack');

        $this->assertFalse($result);
    }

    public function test_filter_channels_for_notification_filters_by_user_preferences(): void
    {
        NotificationPreference::factory()->create([
            'user_id' => $this->user->id,
            'channel' => 'mail',
            'event_type' => 'order_created',
            'enabled' => true,
        ]);

        NotificationPreference::factory()->create([
            'user_id' => $this->user->id,
            'channel' => 'slack',
            'event_type' => 'order_created',
            'enabled' => false,
        ]);

        $notification = new class extends Notification {
            public function getEventType(): string
            {
                return 'order_created';
            }

            public function via(object $notifiable): array
            {
                return ['mail', 'slack', 'database'];
            }
        };

        $filtered = $this->router->filterChannelsForNotification($this->user, $notification, ['mail', 'slack', 'database']);

        $this->assertEquals(['mail'], $filtered);
    }

    public function test_should_send_to_channel_returns_true_for_enabled(): void
    {
        NotificationPreference::factory()->create([
            'user_id' => $this->user->id,
            'channel' => 'mail',
            'event_type' => 'order_created',
            'enabled' => true,
        ]);

        $notification = new class extends Notification {
            public function getEventType(): string
            {
                return 'order_created';
            }
        };

        $result = $this->router->shouldSendToChannel($this->user, $notification, 'mail');

        $this->assertTrue($result);
    }

    public function test_should_send_to_channel_returns_false_for_disabled(): void
    {
        NotificationPreference::factory()->create([
            'user_id' => $this->user->id,
            'channel' => 'slack',
            'event_type' => 'order_created',
            'enabled' => false,
        ]);

        $notification = new class extends Notification {
            public function getEventType(): string
            {
                return 'order_created';
            }
        };

        $result = $this->router->shouldSendToChannel($this->user, $notification, 'slack');

        $this->assertFalse($result);
    }

    public function test_new_user_gets_default_preferences_seeded(): void
    {
        $newUser = User::factory()->create();

        $preferences = NotificationPreference::where('user_id', $newUser->id)->get();

        $this->assertCount(15, $preferences);

        $mailPreferences = $preferences->where('channel', 'mail');
        $this->assertTrue($mailPreferences->every(fn ($p) => $p->enabled === true));

        $slackPreferences = $preferences->where('channel', 'slack');
        $this->assertTrue($slackPreferences->every(fn ($p) => $p->enabled === false));

        $databasePreferences = $preferences->where('channel', 'database');
        $this->assertTrue($databasePreferences->every(fn ($p) => $p->enabled === true));
    }
}