<?php

namespace Tests\Unit;

use App\Models\User;
use App\Notifications\CustomVerifyEmail;
use App\Services\VerificationEmailSender;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Symfony\Component\Mailer\Exception\TransportException;
use Tests\TestCase;

class VerificationEmailSenderTest extends TestCase
{
    public function test_sender_retries_with_configured_fallback_mailer_after_transport_failure(): void
    {
        config(['mail.fallback_mailer' => 'log']);

        $sender = new class extends VerificationEmailSender
        {
            /** @var array<int, string|null> */
            public array $mailers = [];

            protected function notify(MustVerifyEmail $user, CustomVerifyEmail $notification): void
            {
                $this->mailers[] = $notification->selectedMailer;

                if (count($this->mailers) === 1) {
                    throw new TransportException('SMTP down');
                }
            }
        };

        $sender->send(new User);

        $this->assertSame([null, 'log'], $sender->mailers);
    }

    public function test_sender_rethrows_transport_exception_without_configured_fallback(): void
    {
        config(['mail.fallback_mailer' => null]);

        $sender = new class extends VerificationEmailSender
        {
            protected function notify(MustVerifyEmail $user, CustomVerifyEmail $notification): void
            {
                throw new TransportException('SMTP down');
            }
        };

        $this->expectException(TransportException::class);

        $sender->send(new User);
    }
}
