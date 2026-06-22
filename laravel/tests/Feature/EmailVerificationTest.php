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

    public function test_unverified_user_is_redirected_from_verified_routes()
    {
        $user = User::factory()->create([
            "email_verified_at" => null,
        ]);

        $response = $this->actingAs($user)->get("/email/verify");
        $response->assertStatus(200);
    }

    public function test_verification_notice_page_loads()
    {
        $response = $this->get("/email/verify");
        $response->assertStatus(200);
        $response->assertSee("Email Verification Required");
    }

    public function test_verify_email_with_valid_signature()
    {
        $user = User::factory()->create([
            "email_verified_at" => null,
        ]);

        $url = URL::signedRoute("verification.verify", [
            "id" => $user->id,
            "hash" => sha1($user->email),
        ]);

        $response = $this->actingAs($user)->get($url);
        $response->assertStatus(302);
        $this->assertNotNull($user->fresh()->email_verified_at);
    }

    public function test_resend_verification_email()
    {
        Notification::fake();

        $user = User::factory()->create([
            "email_verified_at" => null,
        ]);

        $response = $this->actingAs($user)
            ->post("/email/verification-notification");

        $response->assertStatus(302);
        $response->assertSessionHas("message");

        Notification::assertSentTo($user, CustomVerifyEmail::class);
    }

    public function test_already_verified_user()
    {
        $user = User::factory()->create([
            "email_verified_at" => now(),
        ]);

        $url = URL::signedRoute("verification.verify", [
            "id" => $user->id,
            "hash" => sha1($user->email),
        ]);

        $response = $this->actingAs($user)->get($url);
        $response->assertSessionHas("message", "Email already verified.");
    }
}
