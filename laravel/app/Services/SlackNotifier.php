<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class SlackNotifier
{
    public function send(string $message, ?string $channel = null, array $attachments = []): array
    {
        $webhookUrl = config('services.slack.notifications.bot_user_oauth_token');
        $defaultChannel = config('services.slack.notifications.channel');

        if (!$webhookUrl) {
            throw new \RuntimeException('Slack webhook URL not configured');
        }

        $payload = [
            'text' => $message,
            'channel' => $channel ?? $defaultChannel,
        ];

        if (!empty($attachments)) {
            $payload['attachments'] = $attachments;
        }

        $maxRetries = 3;
        $timeout = 10;

        for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
            try {
                $response = Http::timeout($timeout)
                    ->retry($maxRetries, 100 * $attempt)
                    ->post($webhookUrl, $payload);

                if ($response->successful()) {
                    return ['success' => true, 'attempt' => $attempt];
                }

                Log::warning("Slack notification failed on attempt {$attempt}", [
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);
            } catch (\Exception $e) {
                Log::error("Slack notification error on attempt {$attempt}: {$e->getMessage()}");
            }

            if ($attempt < $maxRetries) {
                usleep(500000 * $attempt);
            }
        }

        return ['success' => false, 'attempts' => $maxRetries];
    }
}
