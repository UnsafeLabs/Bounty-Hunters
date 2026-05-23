<?php

namespace Tests\Feature;

use App\Models\User;
use App\Notifications\CustomVerifyEmail;
use Illuminate\Auth\Events\Verified;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

class EmailVerificationTest extends TestCase
{
    use RefreshDatabase;

    public function test_signed_verification_link_marks_user_verified(): void
    {
        Event::fake([Verified::class]);
        $user = User::factory()->unverified()->create();

        $url = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes(60),
            ['id' => $user->id, 'hash' => sha1($user->getEmailForVerification())],
        );

        $this->actingAs($user)->get($url)
            ->assertRedirect('/');

        $this->assertTrue($user->fresh()->hasVerifiedEmail());
        Event::assertDispatched(Verified::class);
    }

    public function test_resend_endpoint_sends_custom_verification_notification(): void
    {
        Notification::fake();
        $user = User::factory()->unverified()->create();

        $this->actingAs($user)
            ->post('/email/verification-notification')
            ->assertRedirect()
            ->assertSessionHas('status', 'verification-link-sent');

        Notification::assertSentTo($user, CustomVerifyEmail::class);
    }

    public function test_verified_users_do_not_receive_duplicate_verification_notification(): void
    {
        Notification::fake();
        $user = User::factory()->create();

        $this->actingAs($user)
            ->post('/email/verification-notification')
            ->assertRedirect('/');

        Notification::assertNothingSent();
    }

    public function test_unverified_users_are_redirected_from_verified_routes(): void
    {
        Route::middleware(['web', 'verified'])->get('/verified-only-test', fn () => 'ok');

        $user = User::factory()->unverified()->create();

        $this->actingAs($user)
            ->get('/verified-only-test')
            ->assertRedirect('/email/verify');
    }

    public function test_mail_fallback_configuration_is_available(): void
    {
        config()->set('mail.fallback_mailer', 'log');

        $this->assertSame('log', config('mail.fallback_mailer'));
        $this->assertContains(config('mail.fallback_mailer'), config('mail.mailers.failover.mailers'));
    }
}
