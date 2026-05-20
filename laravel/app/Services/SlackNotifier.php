<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;

class SlackNotifier
{
    public static function send(
        string $message,
        ?string $channel = null,
        ?array $blocks = null,
    ): bool {
        $webhookUrl = config('services.slack.webhook_url');

        if (empty($webhookUrl)) {
            return false;
        }

        $payload = [
            'text' => $message,
        ];

        if ($channel !== null) {
            $payload['channel'] = $channel;
        }

        if ($blocks !== null) {
            $payload['blocks'] = $blocks;
        }

        $attempts = 0;
        $maxAttempts = 2;

        while ($attempts < $maxAttempts) {
            $attempts++;

            $response = Http::timeout(5)->post($webhookUrl, $payload);

            if ($response->successful()) {
                return true;
            }

            if ($attempts >= $maxAttempts || $response->clientError()) {
                return false;
            }
        }

        return false;
    }
}
