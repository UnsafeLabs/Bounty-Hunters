<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;

class SlackNotifier
{
    public static function send(string $webhookUrl, string $text, ?string $channel = null, array $blocks = []): bool
    {
        $payload = ['text' => $text];
        if ($channel !== null) {
            $payload['channel'] = $channel;
        }
        if (!empty($blocks)) {
            $payload['blocks'] = $blocks;
        }

        $response = Http::timeout(5)->retry(1, 100, function ($exception, $request) {
            return $exception->response && $exception->response->serverError();
        })->post($webhookUrl, $payload);

        return $response->successful();
    }
}
