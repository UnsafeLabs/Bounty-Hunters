<?php

namespace App\Notifications;

use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Notifications\Messages\MailMessage;

class CustomVerifyEmail extends VerifyEmail
{
    protected function buildMailMessage($url)
    {
        return (new MailMessage)
            ->subject(sprintf('Verify your %s email address', config('app.name', 'Laravel')))
            ->view('emails.verify-email', [
                'appName' => config('app.name', 'Laravel'),
                'url' => $url,
            ]);
    }
}
