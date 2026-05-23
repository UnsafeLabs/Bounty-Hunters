<?php

namespace App\Services;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class SlackNotifier
{
    public function __construct(
        private readonly ?string $webhookUrl = null,
        private readonly ?string $defaultChannel = null,
    ) {
    }

    public static function send(
        string $text,
        ?string $channel = null,
        array $blocks = [],
    ): Response {
        return app(self::class)->sendMessage($text, $channel, $blocks);
    }

    public function sendMessage(
        string $text,
        ?string $channel = null,
        array $blocks = [],
    ): Response {
        $webhookUrl = $this->webhookUrl ?? config('services.slack.webhook_url');

        if (blank($webhookUrl)) {
            throw new RuntimeException('Slack webhook URL is not configured.');
        }

        $payload = array_filter([
            'text' => $text,
            'channel' => $channel
                ?? $this->defaultChannel
                ?? config('services.slack.default_channel'),
            'blocks' => $blocks ?: null,
        ], fn ($value) => $value !== null);

        $response = Http::timeout(5)->post($webhookUrl, $payload);

        if ($response->serverError()) {
            $response = Http::timeout(5)->post($webhookUrl, $payload);
        }

        return $response->throw();
    }
}
