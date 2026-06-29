<?php

namespace Tests\Feature;

use App\Http\Middleware\EnsureEmailIsVerified;
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

    public function test_signed_verification_link_marks_user_as_verified(): void
    {
        $user = User::factory()->unverified()->create();
        $url = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes(60),
            [
                'id' => $user->id,
                'hash' => sha1($user->email),
            ]
        );

        $this->actingAs($user)
            ->get($url)
            ->assertRedirect('/');

        $this->assertTrue($user->refresh()->hasVerifiedEmail());
    }

    public function test_verification_notification_can_be_resent_and_is_throttled(): void
    {
        Notification::fake();

        $user = User::factory()->unverified()->create();

        $this->actingAs($user)
            ->post('/email/verification-notification')
            ->assertRedirect();

        Notification::assertSentTo($user, CustomVerifyEmail::class);

        $this->actingAs($user)
            ->post('/email/verification-notification')
            ->assertStatus(429);
    }

    public function test_unverified_users_are_redirected_by_verified_middleware(): void
    {
        Route::get('/verified-only', fn () => 'ok')->middleware(EnsureEmailIsVerified::class);

        $this->actingAs(User::factory()->unverified()->create())
            ->get('/verified-only')
            ->assertRedirect(route('verification.notice'));
    }
}
