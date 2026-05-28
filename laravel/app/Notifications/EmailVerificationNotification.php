<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\URL;

class EmailVerificationNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        protected string $verificationUrl
    ) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject(__('Verify Your Email Address'))
            ->greeting(__('Hello!'))
            ->line(__('Please click the button below to verify your email address.'))
            ->action(__('Verify Email Address'), $this->verificationUrl)
            ->line(__('If you did not create an account, no further action is required.'))
            ->salutation(__('Regards'));
    }

    public function toArray(object $notifiable): array
    {
        return [
            'verification_url' => $this->verificationUrl,
        ];
    }
}
