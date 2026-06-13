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

    /**
     * @param  array<int, array<string, mixed>>  $blocks
     */
    public static function send(string $message, ?string $channel = null, array $blocks = []): Response
    {
        return app(static::class)->notify($message, $channel, $blocks);
    }

    /**
     * @param  array<int, array<string, mixed>>  $blocks
     */
    public function notify(string $message, ?string $channel = null, array $blocks = []): Response
    {
        $webhookUrl = $this->webhookUrl ?? config('services.slack.webhook_url');

        if (blank($webhookUrl)) {
            throw new RuntimeException('Slack webhook URL is not configured.');
        }

        $payload = [
            'text' => $message,
        ];

        $channel = $channel ?? $this->defaultChannel ?? config('services.slack.default_channel');
        if (! blank($channel)) {
            $payload['channel'] = $channel;
        }

        if ($blocks !== []) {
            $payload['blocks'] = $blocks;
        }

        $response = $this->post($webhookUrl, $payload);

        if ($response->serverError()) {
            $response = $this->post($webhookUrl, $payload);
        }

        if ($response->failed()) {
            $response->throw();
        }

        return $response;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function post(string $webhookUrl, array $payload): Response
    {
        return Http::timeout(5)->post($webhookUrl, $payload);
    }
}
