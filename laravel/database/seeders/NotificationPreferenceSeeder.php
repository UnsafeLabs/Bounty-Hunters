<?php

namespace Database\Seeders;

use App\Models\NotificationPreference;
use App\Models\User;
use Illuminate\Database\Seeder;

class NotificationPreferenceSeeder extends Seeder
{
    public function run()
    {
        $eventTypes = ['account_activity', 'security_alerts', 'marketing'];
        $channels = ['mail', 'slack', 'database'];
        
        User::all()->each(function ($user) use ($eventTypes, $channels) {
            foreach ($eventTypes as $eventType) {
                foreach ($channels as $channel) {
                    NotificationPreference::firstOrCreate([
                        'user_id' => $user->id,
                        'channel' => $channel,
                        'event_type' => $eventType,
                    ], [
                        'enabled' => true,
                    ]);
                }
            }
        });
    }

    public function createDefaultPreferences($user)
    {
        $this->run();
    }
}