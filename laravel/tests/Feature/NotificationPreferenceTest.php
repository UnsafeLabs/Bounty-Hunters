<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\NotificationPreference;
use App\Services\NotificationRouter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationPreferenceTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_gets_default_preferences_on_create()
    {
        $user = User::factory()->create(["active" => 1]);
        $this->assertGreaterThan(0, $user->notificationPreferences->count());
    }

    public function test_preference_can_be_toggled()
    {
        $user = User::factory()->create(["active" => 1]);
        $pref = $user->notificationPreferences->first();
        $pref->update(["enabled" => false]);
        $this->assertFalse($pref->fresh()->enabled);
    }

    public function test_notification_router_checks_preference()
    {
        $user = User::factory()->create(["active" => 1]);
        $pref = $user->notificationPreferences()->where("channel", "mail")->first();
        $pref->update(["enabled" => false]);
        $shouldSend = NotificationRouter::shouldSend($user, "mail", "new_message");
        $this->assertFalse($shouldSend);
    }

    public function test_unique_constraint_prevents_duplicates()
    {
        $this->expectException(\Illuminate\Database\QueryException::class);
        $user = User::factory()->create(["active" => 1]);
        NotificationPreference::create([
            "user_id" => $user->id,
            "channel" => "mail",
            "event_type" => "new_message",
        ]);
    }
}
