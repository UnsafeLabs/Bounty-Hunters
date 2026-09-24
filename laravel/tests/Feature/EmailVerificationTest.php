<?php

namespace Tests\Feature;

use App\Models\User;
use App\Notifications\CustomVerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Mail\Transport\ArrayTransport;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Facades\View;
use ReflectionProperty;
use Symfony\Component\Mailer\Transport\FailoverTransport;
use Symfony\Component\Mailer\Transport\RoundRobinTransport;
use Tests\TestCase;

class EmailVerificationTest extends TestCase
{
    use RefreshDatabase;

    private function unverifiedUser(): User
    {
        return User::factory()->create(['email_verified_at' => null]);
    }

    public function test_verification_notice_page_is_shown_to_unverified_users(): void
    {
        $this->actingAs($this->unverifiedUser())
            ->get('/email/verify')
            ->assertOk()
            ->assertSee('Verify your email address');
    }

    public function test_email_is_verified_via_signed_url(): void
    {
        $user = $this->unverifiedUser();

        $url = URL::temporarySignedRoute('verification.verify', now()->addMinutes(60), [
            'id' => $user->id,
            'hash' => sha1($user->email),
        ]);

        $this->actingAs($user)->get($url)->assertRedirect('/');

        $this->assertTrue($user->fresh()->hasVerifiedEmail());
    }

    public function test_signed_url_with_wrong_hash_is_rejected(): void
    {
        $user = $this->unverifiedUser();

        $url = URL::temporarySignedRoute('verification.verify', now()->addMinutes(60), [
            'id' => $user->id,
            'hash' => sha1('someone-else@example.com'),
        ]);

        $this->actingAs($user)->get($url)->assertForbidden();
        $this->assertFalse($user->fresh()->hasVerifiedEmail());
    }

    public function test_verification_notification_is_sent(): void
    {
        Notification::fake();

        $user = $this->unverifiedUser();

        $this->actingAs($user)
            ->post(route('verification.send'))
            ->assertRedirect();

        Notification::assertSentTo($user, CustomVerifyEmail::class);
    }

    public function test_resend_is_rate_limited_to_once_per_minute(): void
    {
        Notification::fake();

        $user = $this->unverifiedUser();

        $this->actingAs($user)->post(route('verification.send'))->assertRedirect();
        $this->actingAs($user)->post(route('verification.send'))->assertStatus(429);
    }

    public function test_custom_notification_uses_branded_template(): void
    {
        $user = $this->unverifiedUser();

        // The notification must point at our own blade view...
        Notification::fake();
        $this->actingAs($user)->post(route('verification.send'));
        Notification::assertSentTo($user, CustomVerifyEmail::class, function (CustomVerifyEmail $notification) use ($user) {
            return $notification->toMail($user)->view === 'emails.verify-email';
        });

        // ...and that view must render the verification link.
        $html = View::make('emails.verify-email', [
            'url' => 'https://example.com/verify/1/abc',
            'user' => $user,
        ])->render();

        $this->assertStringContainsString('Verify email address', $html);
        $this->assertStringContainsString('https://example.com/verify/1/abc', $html);
    }

    public function test_unverified_users_are_redirected_from_protected_routes(): void
    {
        Route::middleware(['web', 'auth', 'verified'])->get('/dashboard', fn () => 'dashboard');

        $this->actingAs($this->unverifiedUser())
            ->get('/dashboard')
            ->assertRedirect(route('verification.notice'));

        $verified = User::factory()->create();
        $this->actingAs($verified)->get('/dashboard')->assertOk()->assertSee('dashboard');
    }

    public function test_fallback_mailer_is_used_when_primary_fails(): void
    {
        config([
            'mail.default' => 'failover',
            'mail.mailers.broken' => [
                'transport' => 'smtp',
                'host' => '127.0.0.1',
                'port' => 1,
                'timeout' => 1,
            ],
            'mail.mailers.fallback' => ['transport' => 'array'],
            'mail.mailers.failover' => [
                'transport' => 'failover',
                'mailers' => ['broken', 'fallback'],
            ],
        ]);

        // The primary SMTP mailer points at a closed port, so its send throws a
        // TransportException and the failover chain must hand the message to the
        // array fallback instead of propagating the failure.
        Mail::raw('Fallback check', function ($message) {
            $message->to('user@example.com')->subject('Fallback');
        });

        $failover = Mail::mailer('failover')->getSymfonyTransport();

        $this->assertInstanceOf(FailoverTransport::class, $failover);

        $transports = (new ReflectionProperty(RoundRobinTransport::class, 'transports'))
            ->getValue($failover);

        $fallback = null;

        foreach ($transports as $transport) {
            if ($transport instanceof ArrayTransport) {
                $fallback = $transport;
                break;
            }
        }

        $this->assertNotNull($fallback, 'The array fallback transport was not part of the failover chain.');
        $this->assertCount(1, $fallback->messages());
    }
}
