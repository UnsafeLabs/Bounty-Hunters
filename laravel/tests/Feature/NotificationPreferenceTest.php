<?php

namespace Tests\Feature;

use App\Models\NotificationPreference;
use App\Models\User;
use App\Services\NotificationRouter;
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
            'event_type' => 'security.alert',
            'enabled' => true,
        ]);

        $this->putJson('/notifications/preferences/'.$preference->id, [
            'enabled' => false,
        ])->assertOk()->assertJsonPath('enabled', false);
    }

    public function test_bulk_update_toggles_multiple_preferences(): void
    {
        $user = User::factory()->create();
        $mail = NotificationPreference::query()->create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'security.alert',
            'enabled' => true,
        ]);
        $slack = NotificationPreference::query()->create([
            'user_id' => $user->id,
            'channel' => 'slack',
            'event_type' => 'security.alert',
            'enabled' => true,
        ]);

        $this->postJson('/notifications/preferences/bulk', [
            'preferences' => [
                ['id' => $mail->id, 'enabled' => false],
                ['id' => $slack->id, 'enabled' => false],
            ],
        ])->assertOk()->assertJsonCount(2);

        $this->assertFalse($mail->refresh()->enabled);
        $this->assertFalse($slack->refresh()->enabled);
    }

    public function test_router_filters_disabled_channels(): void
    {
        $user = User::factory()->create();
        NotificationPreference::query()->create([
            'user_id' => $user->id,
            'channel' => 'mail',
            'event_type' => 'security.alert',
            'enabled' => true,
        ]);
        NotificationPreference::query()->create([
            'user_id' => $user->id,
            'channel' => 'slack',
            'event_type' => 'security.alert',
            'enabled' => false,
        ]);

        $router = new NotificationRouter();

        $this->assertSame(['mail'], $router->channelsFor($user, 'security.alert'));
        $this->assertTrue($router->enabled($user, 'security.alert', 'mail'));
        $this->assertFalse($router->enabled($user, 'security.alert', 'slack'));
        $this->assertCount(1, $router->route($user, 'security.alert', new class extends Notification {
        }));
    }
}
