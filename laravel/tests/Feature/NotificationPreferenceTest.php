<?php

namespace Tests\Feature;

use App\Models\NotificationPreference;
use App\Models\User;
use App\Services\NotificationRouter;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\Notification;
use Tests\TestCase;

class NotificationPreferenceTest extends TestCase
{
    use RefreshDatabase;

    public function test_users_can_list_preferences(): void
    {
        $user = User::factory()->create();
        NotificationPreference::seedDefaultsFor($user);

        $this->getJson('/notifications/preferences?user_id='.$user->id)
            ->assertOk()
            ->assertJsonCount(9);
    }

    public function test_individual_preference_can_be_toggled(): void
    {
        $user = User::factory()->create();
        $preference = NotificationPreference::query()->create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'deploy.finished',
            'enabled' => true,
        ]);

        $this->putJson('/notifications/preferences/'.$preference->id.'?user_id='.$user->id, [
            'enabled' => false,
        ])->assertOk()->assertJsonPath('enabled', false);
    }

    public function test_bulk_update_toggles_multiple_preferences(): void
    {
        $user = User::factory()->create();
        $mail = NotificationPreference::query()->create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'deploy.finished',
            'enabled' => true,
        ]);
        $slack = NotificationPreference::query()->create([
            'user_id' => $user->id,
            'channel' => 'slack',
            'event_type' => 'deploy.finished',
            'enabled' => true,
        ]);

        $this->postJson('/notifications/preferences/bulk?user_id='.$user->id, [
            'preferences' => [
                ['id' => $mail->id, 'enabled' => false],
                ['id' => $slack->id, 'enabled' => false],
            ],
        ])->assertOk()->assertJsonCount(2);

        $this->assertFalse($mail->refresh()->enabled);
        $this->assertFalse($slack->refresh()->enabled);
    }

    public function test_users_cannot_update_another_users_preference(): void
    {
        $owner = User::factory()->create();
        $other = User::factory()->create();
        $preference = NotificationPreference::query()->create([
            'user_id' => $owner->id,
            'channel' => 'mail',
            'event_type' => 'deploy.finished',
            'enabled' => true,
        ]);

        $this->putJson('/notifications/preferences/'.$preference->id.'?user_id='.$other->id, [
            'enabled' => false,
        ])->assertNotFound();

        $this->assertTrue($preference->refresh()->enabled);
    }

    public function test_users_cannot_bulk_update_another_users_preferences(): void
    {
        $owner = User::factory()->create();
        $other = User::factory()->create();
        $preference = NotificationPreference::query()->create([
            'user_id' => $owner->id,
            'channel' => 'mail',
            'event_type' => 'deploy.finished',
            'enabled' => true,
        ]);

        $this->postJson('/notifications/preferences/bulk?user_id='.$other->id, [
            'preferences' => [
                ['id' => $preference->id, 'enabled' => false],
            ],
        ])->assertNotFound();

        $this->assertTrue($preference->refresh()->enabled);
    }

    public function test_new_users_get_default_preferences_seeded(): void
    {
        $user = User::factory()->create();

        $this->assertCount(9, $user->notificationPreferences()->get());
        $this->assertTrue(
            $user->notificationPreferences()
                ->where('channel', 'mail')
                ->where('event_type', 'security.alert')
                ->where('enabled', true)
                ->exists()
        );
    }

    public function test_unique_constraint_prevents_duplicate_preferences(): void
    {
        $user = User::factory()->create();
        NotificationPreference::query()->create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'deploy.finished',
            'enabled' => true,
        ]);

        $this->expectException(QueryException::class);

        NotificationPreference::query()->create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'deploy.finished',
            'enabled' => false,
        ]);
    }

    public function test_router_filters_disabled_channels(): void
    {
        $user = User::factory()->create();
        NotificationPreference::query()->create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'deploy.finished',
            'enabled' => true,
        ]);
        NotificationPreference::query()->create([
            'user_id' => $user->id,
            'channel' => 'slack',
            'event_type' => 'deploy.finished',
            'enabled' => false,
        ]);

        $router = new NotificationRouter();

        $this->assertSame(['mail'], $router->channelsFor($user, 'deploy.finished'));
        $this->assertTrue($router->enabled($user, 'deploy.finished', 'mail'));
        $this->assertFalse($router->enabled($user, 'deploy.finished', 'slack'));
        $this->assertCount(1, $router->route($user, 'deploy.finished', new class extends Notification {
        }));
    }
}
