<?php

namespace App\Services;

use Illuminate\Http\Client\RequestException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

class SlackNotifier
{
    public function __construct(
        private readonly ?string $webhookUrl = null,
        private readonly ?string $defaultChannel = null,
    ) {}

    /**
     * @param  array<int, array<string, mixed>>  $blocks
     *
     * @throws RequestException
     */
    public static function send(string $message, ?string $channel = null, array $blocks = []): void
    {
        app(self::class)->notify($message, $channel, $blocks);
    }

    /**
     * @param  array<int, array<string, mixed>>  $blocks
     *
     * @throws RequestException
     */
    public function notify(string $message, ?string $channel = null, array $blocks = []): void
    {
        $webhookUrl = $this->webhookUrl ?? config('services.slack.webhook_url');

        if (! is_string($webhookUrl) || $webhookUrl === '') {
            throw new \InvalidArgumentException('Slack webhook URL is not configured.');
        }

        $payload = $this->payload($message, $channel, $blocks);
        $response = $this->post($webhookUrl, $payload);

        if ($response->serverError()) {
            $response = $this->post($webhookUrl, $payload);
        }

        $response->throw();
    }

    /**
     * @param  array<int, array<string, mixed>>  $blocks
     * @return array<string, mixed>
     */
    private function payload(string $message, ?string $channel, array $blocks): array
    {
        $payload = [
            'text' => $message,
        ];

        $resolvedChannel = $channel ?? $this->defaultChannel ?? config('services.slack.default_channel');

        if (is_string($resolvedChannel) && $resolvedChannel !== '') {
            $payload['channel'] = $resolvedChannel;
        }

        if ($blocks !== []) {
            $payload['blocks'] = $blocks;
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    protected function post(string $webhookUrl, array $payload): Response
    {
        return Http::timeout(5)->post($webhookUrl, $payload);
    }
}
