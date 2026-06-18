<?php

namespace Tests\Feature;

use App\Models\User;
use App\Notifications\CustomVerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

class EmailVerificationTest extends TestCase
{
    use RefreshDatabase;

    public function test_signed_verification_link_marks_email_as_verified(): void
    {
        $user = User::factory()->unverified()->create();

        Notification::fake();

        $user->sendEmailVerificationNotification();

        Notification::assertSentTo($user, CustomVerifyEmail::class);

        $verificationUrl = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes(60),
            [
                'id' => $user->getKey(),
                'hash' => sha1($user->getEmailForVerification()),
            ],
        );

        $this->actingAs($user)
            ->get($verificationUrl)
            ->assertRedirect('/email/verify?verified=1');

        $this->assertTrue($user->refresh()->hasVerifiedEmail());
    }

    public function test_resend_verification_endpoint_sends_custom_notification_and_is_rate_limited(): void
    {
        $user = User::factory()->unverified()->create();

        Notification::fake();

        $this->actingAs($user)
            ->post('/email/verification-notification')
            ->assertRedirect()
            ->assertSessionHas('status', 'verification-link-sent');

        Notification::assertSentTo($user, CustomVerifyEmail::class);

        $this->actingAs($user)
            ->post('/email/verification-notification')
            ->assertTooManyRequests();
    }

    public function test_custom_verification_notification_uses_branded_blade_template(): void
    {
        $user = User::factory()->unverified()->create();

        $mailMessage = (new CustomVerifyEmail)->toMail($user);

        $this->assertSame('emails.verify-email', $mailMessage->view);
        $this->assertSame('Verify your Laravel email address', $mailMessage->subject);
        $this->assertSame('Laravel', $mailMessage->viewData['appName']);
        $this->assertArrayHasKey('url', $mailMessage->viewData);
    }

    public function test_verified_middleware_redirects_unverified_users_to_notice(): void
    {
        Route::middleware(['web', 'auth', 'verified'])
            ->get('/verified-only-test', fn () => 'verified')
            ->name('verified-only-test');

        $user = User::factory()->unverified()->create();

        $this->actingAs($user)
            ->get('/verified-only-test')
            ->assertRedirect(route('verification.notice'));
    }

    public function test_mail_configuration_uses_failover_and_fallback_mailer(): void
    {
        config(['mail.default' => 'failover']);

        $this->assertSame('failover', config('mail.default'));
        $this->assertSame('log', config('mail.fallback_mailer'));
        $this->assertSame('failover', config('mail.mailers.failover.transport'));
        $this->assertSame(['smtp', 'log'], config('mail.mailers.failover.mailers'));
    }
}
