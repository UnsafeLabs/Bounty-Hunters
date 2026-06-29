<?php

namespace App\Notifications;

use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Notifications\Messages\MailMessage;

class CustomVerifyEmail extends VerifyEmail
{
    public ?string $selectedMailer = null;

    public function usingMailer(string $mailer): static
    {
        $this->selectedMailer = $mailer;

        return $this;
    }

    protected function buildMailMessage($url)
    {
        $message = (new MailMessage)
            ->subject('Verify your '.config('app.name').' email address')
            ->markdown('emails.verify-email', [
                'appName' => config('app.name'),
                'verificationUrl' => $url,
                'expiresIn' => config('auth.verification.expire', 60),
            ]);

        if ($this->selectedMailer !== null) {
            $message->mailer($this->selectedMailer);
        }

        return $message;
    }
}
