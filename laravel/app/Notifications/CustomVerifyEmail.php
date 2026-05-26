<?php

namespace App\Notifications;

use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Notifications\Messages\MailMessage;

class CustomVerifyEmail extends VerifyEmail
{
    public function toMail($notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject('Verify your email address')
            ->greeting('Welcome to '.config('app.name'))
            ->line('Please verify your email address before using protected account features.')
            ->action('Verify email address', $this->verificationUrl($notifiable))
            ->line('If you did not create an account, no further action is required.');
    }
}
