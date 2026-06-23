<?php

namespace Tests\Feature;

use App\Models\User;
use App\Notifications\RoutesThroughPreferences;
use App\Services\NotificationRouter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\Notification;
use InvalidArgumentException;
use Tests\TestCase;

class NotificationRouterTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::forceCreate([
            'name' => 'Router User',
            'email' => 'router@example.com',
            'password' => bcrypt('password'),
        ]);
    }

    private function setPreference(User $user, string $eventType, string $channel, bool $enabled): void
    {
        // Every pair is seeded on creation, so update the existing row in place.
        $user->notificationPreferences()->updateOrCreate(
            ['event_type' => $eventType, 'channel' => $channel],
            ['enabled' => $enabled],
        );
    }

    public function test_a_user_without_changes_receives_the_default_channels(): void
    {
        $user = $this->user();

        $this->assertSame(['mail', 'database'], NotificationRouter::channelsFor($user, 'marketing'));
    }

    public function test_an_explicitly_disabled_default_channel_is_excluded(): void
    {
        $user = $this->user();
        $this->setPreference($user, 'marketing', 'mail', false);

        $this->assertSame(['database'], NotificationRouter::channelsFor($user, 'marketing'));
    }

    public function test_an_explicitly_enabled_non_default_channel_is_included(): void
    {
        $user = $this->user();
        $this->setPreference($user, 'marketing', 'slack', true);

        $this->assertSame(['mail', 'slack', 'database'], NotificationRouter::channelsFor($user, 'marketing'));
    }

    public function test_all_channels_disabled_yields_an_empty_route(): void
    {
        $user = $this->user();
        foreach (['mail', 'slack', 'database'] as $channel) {
            $this->setPreference($user, 'security', $channel, false);
        }

        $this->assertSame([], NotificationRouter::channelsFor($user, 'security'));
    }

    public function test_preferences_for_one_event_type_do_not_leak_into_another(): void
    {
        $user = $this->user();
        $this->setPreference($user, 'marketing', 'mail', false);

        // security keeps its seeded defaults.
        $this->assertSame(['mail', 'database'], NotificationRouter::channelsFor($user, 'security'));
    }

    public function test_unknown_event_type_throws(): void
    {
        $user = $this->user();

        $this->expectException(InvalidArgumentException::class);

        NotificationRouter::channelsFor($user, 'not_a_type');
    }

    public function test_is_enabled_reports_single_channel_state(): void
    {
        $user = $this->user();
        $this->setPreference($user, 'account', 'slack', true);
        $this->setPreference($user, 'account', 'mail', false);

        $this->assertTrue(NotificationRouter::isEnabled($user, 'account', 'slack'));
        $this->assertFalse(NotificationRouter::isEnabled($user, 'account', 'mail'));
    }

    public function test_a_notification_using_the_trait_is_routed_through_preferences(): void
    {
        $user = $this->user();
        $this->setPreference($user, 'product_updates', 'mail', false);
        $this->setPreference($user, 'product_updates', 'slack', true);

        $notification = new class extends Notification
        {
            use RoutesThroughPreferences;

            public function eventType(): string
            {
                return 'product_updates';
            }
        };

        $this->assertSame(['slack', 'database'], $notification->via($user));
    }
}
