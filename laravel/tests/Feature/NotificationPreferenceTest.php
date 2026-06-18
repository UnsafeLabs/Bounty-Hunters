<?php

namespace Tests\Feature;

use App\Models\NotificationPreference;
use App\Models\User;
use App\Services\NotificationRouter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class NotificationPreferenceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['app.key' => 'base64:'.base64_encode(str_repeat('b', 32))]);
    }

    public function test_new_users_receive_default_preferences(): void
    {
        $user = User::factory()->create();

        $this->assertSame(9, $user->notificationPreferences()->count());
        $this->assertDatabaseHas('notification_preferences', [
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'user.created',
            'enabled' => true,
        ]);
    }

    public function test_user_can_list_and_update_own_preferences(): void
    {
        $user = User::factory()->create();
        $preference = $user->notificationPreferences()->where('channel', 'mail')->firstOrFail();

        $this->actingAs($user)
            ->getJson('/api/notifications/preferences')
            ->assertOk()
            ->assertJsonCount(9);

        $this->actingAs($user)
            ->putJson("/api/notifications/preferences/{$preference->id}", ['enabled' => false])
            ->assertOk()
            ->assertJsonPath('enabled', false);

        $this->assertFalse($preference->refresh()->enabled);
    }

    public function test_user_cannot_update_another_users_preference(): void
    {
        $owner = User::factory()->create();
        $other = User::factory()->create();
        $preference = $owner->notificationPreferences()->firstOrFail();

        $this->actingAs($other)
            ->putJson("/api/notifications/preferences/{$preference->id}", ['enabled' => false])
            ->assertNotFound();
    }

    public function test_bulk_update_toggles_multiple_preferences(): void
    {
        $user = User::factory()->create();
        $preferences = $user->notificationPreferences()->limit(2)->get();

        $this->actingAs($user)
            ->postJson('/api/notifications/preferences/bulk', [
                'preferences' => $preferences->map(fn (NotificationPreference $preference): array => [
                    'id' => $preference->id,
                    'enabled' => false,
                ])->all(),
            ])
            ->assertOk();

        $this->assertSame(0, NotificationPreference::query()
            ->whereIn('id', $preferences->pluck('id'))
            ->where('enabled', true)
            ->count());
    }

    public function test_notification_router_filters_disabled_channels(): void
    {
        $user = User::factory()->create();
        $user->notificationPreferences()
            ->where('event_type', 'security.alert')
            ->where('channel', 'slack')
            ->update(['enabled' => false]);

        $router = new NotificationRouter();

        $this->assertSame(
            ['mail', 'database'],
            $router->enabledChannels($user, 'security.alert', ['mail', 'slack', 'database'])
        );
        $this->assertFalse($router->shouldSend($user, 'security.alert', 'slack'));
    }

    public function test_unique_constraint_prevents_duplicate_preferences(): void
    {
        $user = User::factory()->create();

        $this->expectException(\Illuminate\Database\QueryException::class);

        DB::table('notification_preferences')->insert([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'user.created',
            'enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
