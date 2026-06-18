<?php

namespace App\Services;

use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;

class SlackNotifier
{
    /**
     * @param  array<int, array<string, mixed>>  $blocks
     */
    public static function send(string $message, ?string $channel = null, array $blocks = []): void
    {
        (new self)->sendMessage($message, $channel, $blocks);
    }

    /**
     * @param  array<int, array<string, mixed>>  $blocks
     */
    public function sendMessage(string $message, ?string $channel = null, array $blocks = []): void
    {
        $webhookUrl = config('services.slack.webhook_url');

        if (! is_string($webhookUrl) || $webhookUrl === '') {
            throw new InvalidArgumentException('Slack webhook URL is not configured.');
        }

        $payload = $this->payload($message, $channel, $blocks);
        $response = Http::timeout(5)->post($webhookUrl, $payload);

        if ($response->serverError()) {
            $response = Http::timeout(5)->post($webhookUrl, $payload);
        }

        if ($response->failed()) {
            throw new RequestException($response);
        }
    }

    /**
     * @param  array<int, array<string, mixed>>  $blocks
     * @return array<string, mixed>
     */
    private function payload(string $message, ?string $channel, array $blocks): array
    {
        $payload = [
            'text' => $message,
            'channel' => $channel ?? config('services.slack.default_channel'),
        ];

        if ($blocks !== []) {
            $payload['blocks'] = $blocks;
        }

        return array_filter($payload, fn (mixed $value): bool => $value !== null && $value !== '');
    }
}
