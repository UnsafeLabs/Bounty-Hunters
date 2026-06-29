<?php

namespace App\Services;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;

class SlackNotifier
{
    public const TIMEOUT_SECONDS = 5;
    private const MAX_ATTEMPTS = 2;

    public static function send(
        string $message,
        ?string $channel = null,
        array $blocks = [],
    ): void {
        app(self::class)->notify($message, $channel, $blocks);
    }

    public function notify(
        string $message,
        ?string $channel = null,
        array $blocks = [],
    ): void {
        $webhookUrl = config('services.slack.webhook_url');

        if (! is_string($webhookUrl) || $webhookUrl === '') {
            throw new InvalidArgumentException('Slack webhook URL is not configured.');
        }

        $response = null;

        for ($attempt = 1; $attempt <= self::MAX_ATTEMPTS; $attempt++) {
            $response = Http::timeout(self::TIMEOUT_SECONDS)
                ->post($webhookUrl, $this->payload($message, $channel, $blocks));

            if (! $response->serverError() || $attempt === self::MAX_ATTEMPTS) {
                break;
            }
        }

        $this->throwIfFailed($response);
    }

    private function payload(string $message, ?string $channel, array $blocks): array
    {
        $payload = [
            'text' => $message,
        ];

        $channel ??= config('services.slack.default_channel');

        if (is_string($channel) && $channel !== '') {
            $payload['channel'] = $channel;
        }

        if ($blocks !== []) {
            $payload['blocks'] = $blocks;
        }

        return $payload;
    }

    private function throwIfFailed(?Response $response): void
    {
        if ($response === null) {
            return;
        }

        $response->throw();
    }
}
