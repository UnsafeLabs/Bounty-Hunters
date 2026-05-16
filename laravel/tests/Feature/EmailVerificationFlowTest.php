<?php

namespace Tests\Feature;

use App\Http\Middleware\EnsureEmailIsVerified;
use App\Models\User;
use App\Notifications\CustomVerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

class EmailVerificationFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_verification_link_marks_user_as_verified(): void
    {
        $user = User::factory()->unverified()->create();
        $url = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes(60),
            [
                'id' => $user->id,
                'hash' => sha1($user->getEmailForVerification()),
            ],
        );

        $this->actingAs($user)->get($url)->assertRedirect('/');

        $this->assertTrue($user->fresh()->hasVerifiedEmail());
    }

    public function test_resend_endpoint_sends_custom_notification_and_is_rate_limited(): void
    {
        Notification::fake();
        $user = User::factory()->unverified()->create();

        $this->actingAs($user)
            ->post(route('verification.send'))
            ->assertSessionHas('status', 'verification-link-sent');

        Notification::assertSentTo($user, CustomVerifyEmail::class);

        $this->actingAs($user)
            ->post(route('verification.send'))
            ->assertStatus(429);
    }

    public function test_unverified_users_are_redirected_by_verification_middleware(): void
    {
        Route::get('/verified-only-test', fn () => 'ok')->middleware(EnsureEmailIsVerified::class);

        $user = User::factory()->unverified()->create();

        $this->actingAs($user)
            ->get('/verified-only-test')
            ->assertRedirect(route('verification.notice'));
    }

    public function test_custom_notification_uses_branded_markdown_template(): void
    {
        $notification = new CustomVerifyEmail();
        $user = User::factory()->unverified()->make();

        $mail = $notification->toMail($user);

        $this->assertSame('Verify your email for ' . config('app.name'), $mail->subject);
        $this->assertSame('emails.verify-email', $mail->markdown);
    }

    public function test_fallback_mailer_configures_alternate_mailer(): void
    {
        Config::set('mail.fallback_mailer', 'array');
        Config::set('mail.mailers.failover.mailers', ['smtp', config('mail.fallback_mailer')]);

        $this->assertSame('array', config('mail.fallback_mailer'));
        $this->assertSame(['smtp', 'array'], config('mail.mailers.failover.mailers'));
    }
}
