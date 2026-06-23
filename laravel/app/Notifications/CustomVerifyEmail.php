<?php

namespace App\Notifications;

use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Support\Facades\Config;

class CustomVerifyEmail extends VerifyEmail
{
    /**
     * Build the branded mail representation of the notification.
     *
     * Reuses the parent's signed verification URL generation (route
     * "verification.verify" with the id/sha1(email) parameters) but renders
     * a branded blade template instead of the framework's default lines.
     */
    public function toMail($notifiable): MailMessage
    {
        $url = $this->verificationUrl($notifiable);

        return (new MailMessage)
            ->subject('Verify Your Email Address')
            ->view('emails.verify-email', [
                'url' => $url,
                'name' => $notifiable->name ?? null,
                'expireMinutes' => (int) Config::get('auth.verification.expire', 60),
            ]);
    }
}
