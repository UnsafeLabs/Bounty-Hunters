<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;

class SlackNotifier
{
    /**
     * Send a message to a Slack webhook or channel.
     *
     * @param  string        $message  The message text to send
     * @param  array|null    $blocks   Optional Slack Block Kit blocks
     * @param  string|null   $channel  Override the default channel
     * @return bool                    True on success, false on failure
     */
    public static function send(string $message, ?array $blocks = null, ?string $channel = null): bool
    {
        $webhook = config('services.slack.webhook_url');
        $token = config('services.slack.notifications.bot_user_oauth_token');
        $defaultChannel = config('services.slack.notifications.channel', '#general');

        $payload = [
            'text' => $message,
            'channel' => $channel ?? $defaultChannel,
        ];

        if ($blocks) {
            $payload['blocks'] = $blocks;
        }

        $headers = [
            'Content-Type' => 'application/json',
        ];

        if ($token) {
            $headers['Authorization'] = 'Bearer ' . $token;
        }

        try {
            $response = Http::timeout(5)
                ->retry(1, 1000, function ($attempt, $exception) {
                    return $exception === null && $attempt <= 2;
                })
                ->withHeaders($headers)
                ->post($webhook, $payload);

            return $response->successful();
        } catch (\Exception $e) {
            logger()->error('SlackNotifier failed: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Send a formatted notification block message.
     */
    public static function notify(string $title, array $fields, string $color = '#36a64f'): bool
    {
        $blocks = [
            [
                'type' => 'section',
                'text' => [
                    'type' => 'mrkdwn',
                    'text' => '*' . $title . '*',
                ],
            ],
        ];

        $fieldText = [];
        foreach ($fields as $key => $value) {
            $fieldText[] = '*' . $key . ':* ' . $value;
        }

        $blocks[] = [
            'type' => 'section',
            'text' => [
                'type' => 'mrkdwn',
                'text' => implode("\n", $fieldText),
            ],
        ];

        $attachment = [
            [
                'type' => 'section',
                'text' => [
                    'type' => 'mrkdwn',
                    'text' => ':white_check_mark: Notification',
                ],
            ],
        ];

        return self::send($title, array_merge($blocks, $attachment));
    }
}
