<?php

namespace App\Services;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;

class SlackNotifier
{
    public static function send(string $message, ?string $channel = null, array $blocks = []): Response
    {
        return app(self::class)->sendMessage($message, $channel, $blocks);
    }

    /**
     * @param  array<int, array<string, mixed>>  $blocks
     */
    public function sendMessage(string $message, ?string $channel = null, array $blocks = []): Response
    {
        $webhookUrl = config('services.slack.webhook_url');

        if (blank($webhookUrl)) {
            throw new InvalidArgumentException('Slack webhook URL is not configured.');
        }

        $payload = $this->buildPayload($message, $channel, $blocks);
        $response = $this->postWebhook($webhookUrl, $payload);

        if ($response->serverError()) {
            $response = $this->postWebhook($webhookUrl, $payload);
        }

        return $response->throw();
    }

    /**
     * @param  array<int, array<string, mixed>>  $blocks
     * @return array<string, mixed>
     */
    private function buildPayload(string $message, ?string $channel, array $blocks): array
    {
        $payload = [
            'text' => $message,
        ];

        $targetChannel = $channel ?: config('services.slack.default_channel');

        if (filled($targetChannel)) {
            $payload['channel'] = $targetChannel;
        }

        if ($blocks !== []) {
            $payload['blocks'] = $blocks;
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function postWebhook(string $webhookUrl, array $payload): Response
    {
        return Http::timeout(5)->post($webhookUrl, $payload);
    }
}
