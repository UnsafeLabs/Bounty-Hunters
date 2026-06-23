<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationPreferenceTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $email = 'preferences@example.com'): User
    {
        return User::forceCreate([
            'name' => 'Test User',
            'email' => $email,
            'password' => bcrypt('password'),
        ]);
    }

    public function test_a_new_user_is_seeded_with_default_preferences(): void
    {
        $user = $this->user();

        // 4 event types x 3 channels.
        $this->assertDatabaseCount('notification_preferences', 12);
        $this->assertSame(12, $user->notificationPreferences()->count());

        $this->assertDatabaseHas('notification_preferences', [
            'user_id' => $user->id,
            'event_type' => 'marketing',
            'channel' => 'mail',
            'enabled' => true,
        ]);
        $this->assertDatabaseHas('notification_preferences', [
            'user_id' => $user->id,
            'event_type' => 'marketing',
            'channel' => 'slack',
            'enabled' => false,
        ]);
    }

    public function test_index_lists_the_users_seeded_preferences(): void
    {
        $user = $this->user();

        $response = $this->actingAs($user)->getJson('/notifications/preferences');

        $response->assertOk();
        $this->assertCount(12, $response->json('data'));

        $response->assertJsonFragment(['event_type' => 'marketing', 'channel' => 'mail', 'enabled' => true]);
        $response->assertJsonFragment(['event_type' => 'marketing', 'channel' => 'database', 'enabled' => true]);
        $response->assertJsonFragment(['event_type' => 'marketing', 'channel' => 'slack', 'enabled' => false]);
    }

    public function test_index_only_returns_the_authenticated_users_preferences(): void
    {
        $this->user('owner@example.com');
        $other = $this->user('other@example.com');

        $response = $this->actingAs($other)->getJson('/notifications/preferences');

        $response->assertOk();
        $this->assertCount(12, $response->json('data'));
    }

    public function test_update_toggles_a_single_preference_by_id(): void
    {
        $user = $this->user();
        $preference = $user->notificationPreferences()
            ->where('event_type', 'marketing')
            ->where('channel', 'slack')
            ->firstOrFail();

        $this->assertFalse($preference->enabled);

        $this->actingAs($user)
            ->putJson("/notifications/preferences/{$preference->id}", ['enabled' => true])
            ->assertOk()
            ->assertJsonFragment(['id' => $preference->id, 'enabled' => true]);

        $this->assertDatabaseHas('notification_preferences', [
            'id' => $preference->id,
            'enabled' => true,
        ]);
    }

    public function test_update_validates_that_enabled_is_a_required_boolean(): void
    {
        $user = $this->user();
        $preference = $user->notificationPreferences()->firstOrFail();

        $this->actingAs($user)
            ->putJson("/notifications/preferences/{$preference->id}", [])
            ->assertUnprocessable()
            ->assertJsonValidationErrorFor('enabled');
    }

    public function test_update_returns_404_for_a_preference_owned_by_another_user(): void
    {
        $owner = $this->user('owner@example.com');
        $attacker = $this->user('attacker@example.com');

        $foreign = $owner->notificationPreferences()->firstOrFail();

        $this->actingAs($attacker)
            ->putJson("/notifications/preferences/{$foreign->id}", ['enabled' => false])
            ->assertNotFound();

        // The owner's preference is untouched.
        $this->assertDatabaseHas('notification_preferences', [
            'id' => $foreign->id,
            'enabled' => $foreign->enabled,
        ]);
    }

    public function test_bulk_update_toggles_many_preferences_at_once(): void
    {
        $user = $this->user();
        $mail = $user->notificationPreferences()
            ->where('event_type', 'marketing')->where('channel', 'mail')->firstOrFail();
        $slack = $user->notificationPreferences()
            ->where('event_type', 'security')->where('channel', 'slack')->firstOrFail();

        $this->actingAs($user)->postJson('/notifications/preferences/bulk', [
            'preferences' => [
                ['id' => $mail->id, 'enabled' => false],
                ['id' => $slack->id, 'enabled' => true],
            ],
        ])->assertOk();

        $this->assertDatabaseHas('notification_preferences', ['id' => $mail->id, 'enabled' => false]);
        $this->assertDatabaseHas('notification_preferences', ['id' => $slack->id, 'enabled' => true]);

        // No rows were created or removed by a bulk update.
        $this->assertDatabaseCount('notification_preferences', 12);
    }

    public function test_bulk_update_rejects_a_foreign_preference_id(): void
    {
        $owner = $this->user('owner@example.com');
        $attacker = $this->user('attacker@example.com');

        $foreign = $owner->notificationPreferences()->firstOrFail();

        $this->actingAs($attacker)->postJson('/notifications/preferences/bulk', [
            'preferences' => [
                ['id' => $foreign->id, 'enabled' => false],
            ],
        ])->assertUnprocessable()->assertJsonValidationErrorFor('preferences.0.id');

        $this->assertDatabaseHas('notification_preferences', [
            'id' => $foreign->id,
            'enabled' => $foreign->enabled,
        ]);
    }

    public function test_bulk_update_rejects_an_empty_payload(): void
    {
        $user = $this->user();

        $this->actingAs($user)->postJson('/notifications/preferences/bulk', [
            'preferences' => [],
        ])->assertUnprocessable()->assertJsonValidationErrorFor('preferences');
    }

    public function test_bulk_update_rejects_a_null_payload_item(): void
    {
        $user = $this->user();

        // A null entry must not slip past the per-item type checks.
        $this->actingAs($user)->postJson('/notifications/preferences/bulk', [
            'preferences' => [null],
        ])->assertUnprocessable()->assertJsonValidationErrorFor('preferences.0');
    }

    public function test_bulk_update_rejects_a_null_enabled_flag(): void
    {
        $user = $this->user();
        $preference = $user->notificationPreferences()->firstOrFail();

        $this->actingAs($user)->postJson('/notifications/preferences/bulk', [
            'preferences' => [
                ['id' => $preference->id, 'enabled' => null],
            ],
        ])->assertUnprocessable()->assertJsonValidationErrorFor('preferences.0.enabled');

        $this->assertDatabaseHas('notification_preferences', [
            'id' => $preference->id,
            'enabled' => $preference->enabled,
        ]);
    }

    public function test_endpoints_require_authentication(): void
    {
        $preference = $this->user()->notificationPreferences()->firstOrFail();

        $this->getJson('/notifications/preferences')->assertUnauthorized();
        $this->putJson("/notifications/preferences/{$preference->id}", ['enabled' => true])->assertUnauthorized();
        $this->postJson('/notifications/preferences/bulk', ['preferences' => []])->assertUnauthorized();
    }
}
