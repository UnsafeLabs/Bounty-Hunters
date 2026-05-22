<?php

namespace App\Services;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;

class SlackNotifier
{
    /**
     * Send a Slack webhook message.
     *
     * @param  array<int, array<string, mixed>>  $blocks
     */
    public static function send(string $text, ?string $channel = null, array $blocks = []): Response
    {
        return app(self::class)->sendMessage($text, $channel, $blocks);
    }

    /**
     * Send a Slack webhook message using configured defaults.
     *
     * @param  array<int, array<string, mixed>>  $blocks
     */
    public function sendMessage(string $text, ?string $channel = null, array $blocks = []): Response
    {
        $webhookUrl = config('services.slack.webhook_url');

        if (! is_string($webhookUrl) || $webhookUrl === '') {
            throw new InvalidArgumentException('Slack webhook URL is not configured.');
        }

        $payload = array_filter([
            'text' => $text,
            'channel' => $channel ?? config('services.slack.default_channel'),
            'blocks' => $blocks === [] ? null : $blocks,
        ], fn (mixed $value): bool => $value !== null && $value !== '');

        return $this->postWithServerErrorRetry($webhookUrl, $payload);
    }

    /**
     * Post to Slack, retrying once for 5xx responses and never retrying 4xx responses.
     *
     * @param  array<string, mixed>  $payload
     */
    private function postWithServerErrorRetry(string $webhookUrl, array $payload): Response
    {
        $response = Http::timeout(5)->post($webhookUrl, $payload);

        if ($response->serverError()) {
            $response = Http::timeout(5)->post($webhookUrl, $payload);
        }

        return $response->throw();
    }
}
