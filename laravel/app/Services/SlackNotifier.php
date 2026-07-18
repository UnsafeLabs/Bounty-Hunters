<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;

class SlackNotifier
{
    public static function send(string $message, string $channel = null, array $blocks = []): bool
    {
        $webhookUrl = config('services.slack.webhook_url');
        if (!$webhookUrl) {
            return false;
        }

        $payload = [
            'text' => $message,
            'channel' => $channel ?? config('services.slack.channel', '#general'),
        ];

        if (!empty($blocks)) {
            $payload['blocks'] = $blocks;
        }

        try {
            $response = Http::timeout(5)->retry(1, 100, function ($exception) {
                return $exception->getCode() >= 500;
            })->post($webhookUrl, $payload);
            return $response->successful();
        } catch (\Exception $e) {
            return false;
        }
    }
}
