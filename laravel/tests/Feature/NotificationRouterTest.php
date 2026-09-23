<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\NotificationRouter;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
