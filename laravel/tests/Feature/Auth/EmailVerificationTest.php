<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use App\Notifications\CustomVerifyEmail;
use Illuminate\Auth\Events\Verified;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\URL;
use Symfony\Component\Mailer\Envelope;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\TransportInterface;
use Symfony\Component\Mime\RawMessage;
use Tests\TestCase;

class EmailVerificationTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_model_requires_email_verification(): void
    {
        $this->assertInstanceOf(MustVerifyEmail::class, new User);
    }

    public function test_email_can_be_verified_via_signed_url(): void
    {
        Event::fake();

        $user = User::factory()->unverified()->create();

        $url = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes(60),
            ['id' => $user->id, 'hash' => sha1($user->email)]
        );

        $response = $this->actingAs($user)->get($url);

        Event::assertDispatched(Verified::class);
        $this->assertTrue($user->fresh()->hasVerifiedEmail());
        $response->assertRedirect('/?verified=1');
    }

    public function test_email_is_not_verified_with_invalid_hash(): void
    {
        $user = User::factory()->unverified()->create();

        $url = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes(60),
            ['id' => $user->id, 'hash' => sha1('wrong-email@example.com')]
        );

        $this->actingAs($user)->get($url);

        $this->assertFalse($user->fresh()->hasVerifiedEmail());
    }

    public function test_verification_notification_can_be_resent_to_unverified_user(): void
    {
        Notification::fake();

        $user = User::factory()->unverified()->create();

        $this->actingAs($user)
            ->post(route('verification.send'))
            ->assertOk();

        Notification::assertSentTo($user, CustomVerifyEmail::class);
    }

    public function test_already_verified_user_is_redirected_without_resending(): void
    {
        Notification::fake();

        $user = User::factory()->create();

        $this->actingAs($user)
            ->post(route('verification.send'))
            ->assertRedirect('/');

        Notification::assertNothingSent();
    }

    public function test_unverified_user_is_redirected_from_protected_route(): void
    {
        $user = User::factory()->unverified()->create();

        $this->actingAs($user)
            ->get('/dashboard')
            ->assertRedirect(route('verification.notice'));
    }

    public function test_verified_user_can_access_protected_route(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->get('/dashboard')
            ->assertOk();
    }

    public function test_failover_mailer_uses_fallback_when_primary_transport_throws(): void
    {
        $primary = new class implements TransportInterface
        {
            public bool $attempted = false;

            public function send(RawMessage $message, ?Envelope $envelope = null): ?SentMessage
            {
                $this->attempted = true;

                throw new TransportException('Primary SMTP transport is unavailable.');
            }

            public function __toString(): string
            {
                return 'throwing-primary';
            }
        };

        $fallback = new class implements TransportInterface
        {
            public ?RawMessage $delivered = null;

            public function send(RawMessage $message, ?Envelope $envelope = null): ?SentMessage
            {
                $this->delivered = $message;

                return new SentMessage($message, $envelope ?? Envelope::create($message));
            }

            public function __toString(): string
            {
                return 'catching-fallback';
            }
        };

        Mail::extend('throwing', fn () => $primary);
        Mail::extend('catching', fn () => $fallback);

        config([
            'mail.mailers.primary' => ['transport' => 'throwing'],
            'mail.mailers.secondary' => ['transport' => 'catching'],
            'mail.mailers.test-failover' => [
                'transport' => 'failover',
                'mailers' => ['primary', 'secondary'],
            ],
            'mail.default' => 'test-failover',
        ]);

        Mail::raw('Verify your email address', function ($message) {
            $message->to('user@example.com')->subject('Failover delivery');
        });

        $this->assertTrue($primary->attempted, 'The primary transport should be attempted first.');
        $this->assertNotNull($fallback->delivered, 'The fallback transport should deliver after the primary throws.');
    }
}
