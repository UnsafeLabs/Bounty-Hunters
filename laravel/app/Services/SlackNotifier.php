<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Exception;

class SlackNotifier
{
    protected ?string $webhookUrl;
    protected ?string $defaultChannel;

    public function __construct()
    {
        $this->webhookUrl = config('services.slack.webhook_url');
        $this->defaultChannel = config('services.slack.default_channel');
    }

    /**
     * Send a Slack notification.
     * Can be called statically: SlackNotifier::send(...)
     * Or as an instance method: (new SlackNotifier())->send(...)
     */
    public static function send(string $message, ?string $channel = null, array $attachments = []): bool
    {
        $webhookUrl = config('services.slack.webhook_url');
        $defaultChannel = config('services.slack.default_channel');

        if (empty($webhookUrl)) {
            throw new Exception('Slack webhook URL is not configured.');
        }

        $payload = [
            'text' => $message,
        ];

        $channelToSend = $channel ?? $defaultChannel;
        if ($channelToSend !== null && $channelToSend !== '') {
            $payload['channel'] = $channelToSend;
        }

        if (!empty($attachments)) {
            $payload['attachments'] = $attachments;
        }

        $attempts = 0;
        while (true) {
            $attempts++;
            $response = Http::timeout(5)->post($webhookUrl, $payload);

            if ($response->successful()) {
                return true;
            }

            if ($response->serverError()) {
                if ($attempts < 2) {
                    continue; // Retry exactly once on 5xx
                }
                throw new Exception('Slack notification failed after retry. Status: ' . $response->status());
            }

            if ($response->clientError()) {
                throw new Exception('Slack notification failed with a client error. Status: ' . $response->status());
            }

            throw new Exception('Slack notification failed. Status: ' . $response->status());
        }
    }
}
