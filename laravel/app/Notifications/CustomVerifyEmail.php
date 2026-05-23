<?php

namespace App\Notifications;

use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Notifications\Messages\MailMessage;

class CustomVerifyEmail extends VerifyEmail
{
    public function toMail($notifiable): MailMessage
    {
        return (new MailMessage())
            ->subject(config('app.name').' email verification')
            ->markdown('emails.verify-email', [
                'appName' => config('app.name'),
                'verificationUrl' => $this->verificationUrl($notifiable),
            ]);
    }
}
