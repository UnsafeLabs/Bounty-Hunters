<?php

namespace App\Services;

use App\Models\NotificationPreference;

class NotificationRouter
{
    public function route(int $userId, string $type, array $data): array
    {
        $prefs = NotificationPreference::firstOrCreate(
            ['user_id' => $userId],
            ['email_enabled' => true, 'sms_enabled' => false, 'push_enabled' => false, 'slack_enabled' => false]
        );

        $channels = $prefs->getEnabledChannels();
        $results = [];

        foreach ($channels as $channel) {
            $results[$channel] = match ($channel) {
                'email' => $this->sendEmail($userId, $type, $data),
                'sms' => $this->sendSms($userId, $type, $data),
                'push' => $this->sendPush($userId, $type, $data),
                'slack' => $this->sendSlack($userId, $type, $data),
                default => false,
            };
        }

        return $results;
    }

    private function sendEmail(int $userId, string $type, array $data): bool
    {
        return true;
    }

    private function sendSms(int $userId, string $type, array $data): bool
    {
        return true;
    }

    private function sendPush(int $userId, string $type, array $data): bool
    {
        return true;
    }

    private function sendSlack(int $userId, string $type, array $data): bool
    {
        return true;
    }
}
