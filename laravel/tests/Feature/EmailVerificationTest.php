<?php

namespace Tests\Feature;

use App\Models\User;
use App\Notifications\CustomVerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

class EmailVerificationTest extends TestCase
{
    use RefreshDatabase;

    public function test_verification_notice_renders_for_authenticated_users(): void
    {
        $user = User::factory()->create(['email_verified_at' => null]);

        $this
            ->actingAs($user)
            ->get('/email/verify')
            ->assertOk()
            ->assertSee('Verify your email address');
    }

    public function test_user_receives_custom_verification_notification(): void
    {
        Notification::fake();
        $user = User::factory()->create(['email_verified_at' => null]);

        $user->sendEmailVerificationNotification();

        Notification::assertSentTo($user, CustomVerifyEmail::class);
    }

    public function test_signed_verification_link_marks_email_as_verified(): void
    {
        $user = User::factory()->create(['email_verified_at' => null]);
        $url = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes(60),
            ['id' => $user->id, 'hash' => sha1($user->email)]
        );

        $this
            ->actingAs($user)
            ->get($url)
            ->assertRedirect('/');

        $this->assertTrue($user->fresh()->hasVerifiedEmail());
    }

    public function test_resend_route_sends_verification_notification(): void
    {
        Notification::fake();
        $user = User::factory()->create(['email_verified_at' => null]);

        $this
            ->actingAs($user)
            ->post('/email/verification-notification')
            ->assertSessionHas('status', 'verification-link-sent');

        Notification::assertSentTo($user, CustomVerifyEmail::class);
    }

    public function test_failover_mailer_keeps_smtp_with_log_fallback(): void
    {
        $this->assertSame('failover', config('mail.mailers.failover.transport'));
        $this->assertSame(['smtp', 'log'], config('mail.mailers.failover.mailers'));
    }
}
