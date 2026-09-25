<?php

namespace Tests\Feature;

use App\Models\NotificationPreference;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationPreferenceTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create();
    }

    public function test_user_can_list_preferences_by_event_type_and_channel(): void
    {
        $otherUser = User::factory()->create();

        $response = $this->actingAs($this->user)->getJson('/notifications/preferences');

        $response->assertOk()
            ->assertJsonStructure([
                'data',
                'links',
                'meta' => ['current_page', 'per_page', 'total'],
            ])
            ->assertJsonCount(15, 'data')
            ->assertJsonFragment([
                'user_id' => $this->user->id,
                'channel' => 'mail',
                'event_type' => 'order_created',
                'enabled' => true,
            ])
            ->assertJsonMissing(['user_id' => $otherUser->id]);
    }

    public function test_guest_cannot_access_preferences(): void
    {
        $this->getJson('/notifications/preferences')->assertUnauthorized();
    }

    public function test_guest_browser_request_does_not_redirect_to_a_missing_login_route(): void
    {
        $this->get('/notifications/preferences')->assertUnauthorized();
    }

    public function test_user_can_toggle_an_individual_preference(): void
    {
        $preference = $this->preference('order_created', 'mail');

        $this->actingAs($this->user)
            ->putJson("/notifications/preferences/{$preference->id}", ['enabled' => false])
            ->assertOk()
            ->assertJsonPath('enabled', false);

        $this->assertDatabaseHas('notification_preferences', [
            'id' => $preference->id,
            'enabled' => false,
        ]);

        $this->actingAs($this->user)
            ->putJson("/notifications/preferences/{$preference->id}", ['enabled' => true])
            ->assertOk()
            ->assertJsonPath('enabled', true);

        $this->assertTrue($preference->fresh()->enabled);
    }

    public function test_user_cannot_update_another_users_preference(): void
    {
        $preference = User::factory()->create()
            ->notificationPreferences()
            ->where('event_type', 'order_created')
            ->where('channel', 'mail')
            ->firstOrFail();

        $this->actingAs($this->user)
            ->putJson("/notifications/preferences/{$preference->id}", ['enabled' => false])
            ->assertForbidden();

        $this->assertTrue($preference->fresh()->enabled);
    }

    public function test_user_can_bulk_update_preferences(): void
    {
        $mail = $this->preference('order_created', 'mail');
        $slack = $this->preference('order_created', 'slack');

        $this->actingAs($this->user)
            ->postJson('/notifications/preferences/bulk', [
                'preferences' => [
                    ['id' => $mail->id, 'enabled' => false],
                    ['id' => $slack->id, 'enabled' => true],
                ],
            ])
            ->assertOk()
            ->assertJsonCount(2);

        $this->assertFalse($mail->fresh()->enabled);
        $this->assertTrue($slack->fresh()->enabled);
    }

    public function test_bulk_update_returns_updated_preferences(): void
    {
        $mail = $this->preference('order_created', 'mail');
        $slack = $this->preference('order_created', 'slack');

        $response = $this->actingAs($this->user)
            ->postJson('/notifications/preferences/bulk', [
                'preferences' => [
                    ['id' => $mail->id, 'enabled' => false],
                    ['id' => $slack->id, 'enabled' => true],
                ],
            ])
            ->assertOk();

        $response->assertJsonFragment(['id' => $mail->id, 'enabled' => false]);
        $response->assertJsonFragment(['id' => $slack->id, 'enabled' => true]);
    }

    public function test_bulk_update_rejects_another_users_preference_at_validation(): void
    {
        $ownPreference = $this->preference('order_created', 'mail');
        $otherPreference = User::factory()->create()
            ->notificationPreferences()
            ->where('event_type', 'order_created')
            ->where('channel', 'mail')
            ->firstOrFail();

        $this->actingAs($this->user)
            ->postJson('/notifications/preferences/bulk', [
                'preferences' => [
                    ['id' => $ownPreference->id, 'enabled' => false],
                    ['id' => $otherPreference->id, 'enabled' => false],
                ],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('preferences.1.id');

        $this->assertTrue($ownPreference->fresh()->enabled);
        $this->assertTrue($otherPreference->fresh()->enabled);
    }

    public function test_bulk_update_rejects_unknown_preference_without_changing_owned_preferences(): void
    {
        $ownPreference = $this->preference('order_created', 'mail');

        $this->actingAs($this->user)
            ->postJson('/notifications/preferences/bulk', [
                'preferences' => [
                    ['id' => $ownPreference->id, 'enabled' => false],
                    ['id' => 999999, 'enabled' => false],
                ],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('preferences.1.id');

        $this->assertTrue($ownPreference->fresh()->enabled);
    }

    public function test_bulk_update_rejects_empty_array(): void
    {
        $this->actingAs($this->user)
            ->postJson('/notifications/preferences/bulk', [
                'preferences' => [],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('preferences');
    }

    public function test_bulk_update_rejects_duplicate_ids(): void
    {
        $preference = $this->preference('order_created', 'mail');

        $this->actingAs($this->user)
            ->postJson('/notifications/preferences/bulk', [
                'preferences' => [
                    ['id' => $preference->id, 'enabled' => false],
                    ['id' => $preference->id, 'enabled' => true],
                ],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('preferences.1.id');
    }

    public function test_new_user_receives_default_preferences(): void
    {
        $preferences = $this->user->notificationPreferences;

        $this->assertCount(15, $preferences);
        $this->assertEqualsCanonicalizing(
            NotificationPreference::DEFAULT_EVENT_TYPES,
            $preferences->pluck('event_type')->unique()->values()->all(),
        );
        $this->assertEqualsCanonicalizing(
            NotificationPreference::CHANNELS,
            $preferences->pluck('channel')->unique()->values()->all(),
        );
        $this->assertTrue($preferences->where('channel', 'mail')->every->enabled);
        $this->assertTrue($preferences->where('channel', 'database')->every->enabled);
        $this->assertFalse($preferences->where('channel', 'slack')->contains->enabled);
    }

    public function test_unique_constraint_prevents_duplicate_preferences(): void
    {
        $this->expectException(QueryException::class);

        NotificationPreference::create([
            'user_id' => $this->user->id,
            'channel' => 'mail',
            'event_type' => 'order_created',
            'enabled' => false,
        ]);
    }

    public function test_index_returns_paginated_response(): void
    {
        $response = $this->actingAs($this->user)->getJson('/notifications/preferences');

        $response->assertOk()
            ->assertJsonStructure([
                'data',
                'links' => ['first', 'last', 'prev', 'next'],
                'meta' => ['current_page', 'from', 'last_page', 'path', 'per_page', 'to', 'total'],
            ]);
        $this->assertEquals(50, $response->json('meta.per_page'));
    }

    private function preference(string $eventType, string $channel): NotificationPreference
    {
        return $this->user->notificationPreferences()
            ->where('event_type', $eventType)
            ->where('channel', $channel)
            ->firstOrFail();
    }
}
