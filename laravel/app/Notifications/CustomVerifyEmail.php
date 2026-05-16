<?php

namespace App\Notifications;

use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Notifications\Messages\MailMessage;

class CustomVerifyEmail extends VerifyEmail
{
    public function toMail($notifiable): MailMessage
    {
        return (new MailMessage())
            ->subject('Verify your email for ' . config('app.name'))
            ->markdown('emails.verify-email', [
                'appName' => config('app.name'),
                'url' => $this->verificationUrl($notifiable),
            ]);
    }
}
