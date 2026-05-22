<?php

namespace App\Notifications;

use Illuminate\Notifications\Notification;

class RoutedNotification extends Notification
{
    /**
     * @param  array<int, string>  $channels
     */
    public function __construct(
        public readonly Notification $notification,
        private readonly array $channels,
    ) {}

    /**
     * Get the filtered delivery channels.
     *
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        return $this->channels;
    }

    /**
     * Forward channel-specific formatting methods to the wrapped notification.
     *
     * @param  array<int, mixed>  $parameters
     */
    public function __call(string $method, array $parameters): mixed
    {
        return $this->notification->{$method}(...$parameters);
    }
}
