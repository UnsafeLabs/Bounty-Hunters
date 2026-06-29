<?php

namespace App\Services;

use App\Notifications\CustomVerifyEmail;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Symfony\Component\Mailer\Exception\TransportExceptionInterface;

class VerificationEmailSender
{
    public function send(MustVerifyEmail $user): void
    {
        try {
            $this->notify($user, new CustomVerifyEmail);
        } catch (TransportExceptionInterface $exception) {
            $fallbackMailer = config('mail.fallback_mailer');

            if (! is_string($fallbackMailer) || $fallbackMailer === '') {
                throw $exception;
            }

            $this->notify($user, (new CustomVerifyEmail)->usingMailer($fallbackMailer));
        }
    }

    protected function notify(MustVerifyEmail $user, CustomVerifyEmail $notification): void
    {
        $user->notify($notification);
    }
}
