<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\NotificationRouter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\ChannelManager;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\Notification as NotificationFacade;
use Tests\TestCase;

class NotificationRouterTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected NotificationRouter $router;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create();
        $this->router = app(NotificationRouter::class);
    }

    public function test_filter_channels_returns_only_channels_enabled_for_the_event(): void
    {
        $this->setPreference('order_created', 'database', false);
        $this->setPreference('order_created', 'slack', true);

        $channels = $this->router->filterChannels(
            $this->user,
            'order_created',
            ['mail', 'slack', 'database'],
        );

        $this->assertSame(['mail', 'slack'], $channels);
    }

    public function test_send_dispatches_notification_only_to_enabled_channels(): void
    {
        NotificationFacade::fake();
        $this->setPreference('order_created', 'database', false);
        $this->setPreference('order_created', 'slack', true);
        $notification = $this->notification();

        $this->router->send($this->user, $notification, 'order_created');

        NotificationFacade::assertSentTo(
            $this->user,
            $notification::class,
            fn (Notification $sent, array $channels): bool => $sent === $notification
                && $channels === ['mail', 'slack'],
        );
    }

    public function test_send_does_not_dispatch_when_all_channels_are_disabled(): void
    {
        NotificationFacade::fake();

        foreach (['mail', 'slack', 'database'] as $channel) {
            $this->setPreference('order_created', $channel, false);
        }

        $this->router->send($this->user, $this->notification(), 'order_created');

        NotificationFacade::assertNothingSent();
    }

    public function test_slack_notification_channel_is_registered(): void
    {
        $this->assertIsObject(app(ChannelManager::class)->driver('slack'));
    }

    public function test_send_can_dispatch_an_enabled_database_notification(): void
    {
        $notification = new class extends Notification
        {
            public function via(object $notifiable): array
            {
                return ['database'];
            }

            public function toArray(object $notifiable): array
            {
                return ['message' => 'Order created'];
            }
        };

        $this->router->send($this->user, $notification, 'order_created');

        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $this->user->id,
            'notifiable_type' => User::class,
            'data' => json_encode(['message' => 'Order created']),
        ]);
    }

    public function test_send_dispatches_only_to_channels_supported_by_notification(): void
    {
        NotificationFacade::fake();
        $this->setPreference('order_created', 'slack', true);
        $this->setPreference('order_created', 'database', true);

        $notification = new class extends Notification
        {
            public function via(object $notifiable): array
            {
                return ['mail'];
            }
        };

        $this->router->send($this->user, $notification, 'order_created');

        NotificationFacade::assertSentTo(
            $this->user,
            $notification::class,
            fn (Notification $sent, array $channels): bool => $channels === ['mail'],
        );
    }

    public function test_send_does_not_dispatch_when_notification_supports_no_enabled_channels(): void
    {
        NotificationFacade::fake();
        $this->setPreference('order_created', 'mail', false);
        $this->setPreference('order_created', 'slack', false);
        $this->setPreference('order_created', 'database', false);

        $notification = new class extends Notification
        {
            public function via(object $notifiable): array
            {
                return ['mail', 'slack'];
            }
        };

        $this->router->send($this->user, $notification, 'order_created');

        NotificationFacade::assertNothingSent();
    }

    public function test_get_enabled_channels_returns_only_enabled_channels(): void
    {
        $this->setPreference('order_created', 'database', false);
        $this->setPreference('order_created', 'slack', true);

        $channels = $this->router->getEnabledChannels($this->user, 'order_created');

        $this->assertEqualsCanonicalizing(['mail', 'slack'], $channels);
    }

    public function test_get_enabled_channels_returns_empty_when_all_disabled(): void
    {
        foreach (['mail', 'slack', 'database'] as $channel) {
            $this->setPreference('order_created', $channel, false);
        }

        $channels = $this->router->getEnabledChannels($this->user, 'order_created');

        $this->assertEmpty($channels);
    }

    public function test_is_channel_enabled_returns_true_for_enabled_channel(): void
    {
        $this->setPreference('order_created', 'slack', true);

        $this->assertTrue($this->router->isChannelEnabled($this->user, 'order_created', 'slack'));
    }

    public function test_is_channel_enabled_returns_false_for_disabled_channel(): void
    {
        $this->setPreference('order_created', 'slack', false);

        $this->assertFalse($this->router->isChannelEnabled($this->user, 'order_created', 'slack'));
    }

    public function test_is_channel_enabled_returns_false_for_unknown_event_type(): void
    {
        $this->assertFalse($this->router->isChannelEnabled($this->user, 'unknown_event', 'mail'));
    }

    public function test_is_channel_enabled_returns_false_for_unknown_channel(): void
    {
        $this->assertFalse($this->router->isChannelEnabled($this->user, 'order_created', 'unknown_channel'));
    }

    public function test_send_with_notification_supporting_no_channels(): void
    {
        NotificationFacade::fake();

        $notification = new class extends Notification
        {
            public function via(object $notifiable): array
            {
                return [];
            }
        };

        $this->router->send($this->user, $notification, 'order_created');

        NotificationFacade::assertNothingSent();
    }

    private function setPreference(string $eventType, string $channel, bool $enabled): void
    {
        $this->user->notificationPreferences()
            ->where('event_type', $eventType)
            ->where('channel', $channel)
            ->update(['enabled' => $enabled]);
    }

    private function notification(): Notification
    {
        return new class extends Notification
        {
            public function via(object $notifiable): array
            {
                return ['mail', 'slack', 'database'];
            }
        };
    }
}
