<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\NotificationPreference;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationPreferenceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // Run the migrations for the notification preferences table
        $this->artisan('migrate', ['--path' => 'database/migrations']);
    }

    /** @test */
    public function a_user_can_list_their_preferences()
    {
        $user = User::factory()->create();
        NotificationPreference::factory()->count(3)->create(['user_id' => $user->id]);

        $response = $this->actingAs($user, 'sanctum')
                         ->getJson('/api/notifications/preferences');

        $response->assertOk()
                 ->assertJsonCount(3);
    }

    /** @test */
    public function a_user_can_update_a_single_preference()
    {
        $user = User::factory()->create();
        $pref = NotificationPreference::factory()->create(['user_id' => $user->id, 'enabled' => true]);

        $response = $this->actingAs($user, 'sanctum')
                         ->putJson("/api/notifications/preferences/{$pref->id}", ['enabled' => false]);

        $response->assertOk()
                 ->assertJsonPath('enabled', false);

        $this->assertDatabaseHas('notification_preferences', [
            'id' => $pref->id,
            'enabled' => false,
        ]);
    }

    /** @test */
    public function a_user_can_bulk_update_preferences()
    {
        $user = User::factory()->create();
        $prefs = NotificationPreference::factory()->count(2)->create(['user_id' => $user->id, 'enabled' => true]);

        $payload = $prefs->map(fn($p) => ['id' => $p->id, 'enabled' => false])->toArray();

        $response = $this->actingAs($user, 'sanctum')
                         ->postJson('/api/notifications/preferences/bulk', $payload);

        $response->assertOk()
                 ->assertJsonCount(2)
                 ->assertJsonFragment(['enabled' => false]);

        foreach ($prefs as $pref) {
            $this->assertDatabaseHas('notification_preferences', [
                'id' => $pref->id,
                'enabled' => false,
            ]);
        }
    }

    /** @test */
    public function notification_router_respects_user_preferences()
    {
        $user = User::factory()->create();
        // Only enable mail for order_created
        NotificationPreference::factory()->create([
            'user_id'    => $user->id,
            'channel'    => 'mail',
            'event_type' => 'order_created',
            'enabled'    => true,
        ]);
        NotificationPreference::factory()->create([
            'user_id'    => $user->id,
            'channel'    => 'slack',
            'event_type' => 'order_created',
            'enabled'    => false,
        ]);

        $router = new \App\Services\NotificationRouter();

        $channels = $router->resolveChannels($user, 'order_created');

        $this->assertEquals(['mail'], $channels);
    }
}
