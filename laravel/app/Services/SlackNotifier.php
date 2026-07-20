<?php

namespace App\Services;

use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class SlackNotifier
{
    public static function send(string $text, ?string $channel = null, array $blocks = []): void
    {
        (new self())->notify($text, $channel, $blocks);
    }

    public function notify(string $text, ?string $channel = null, array $blocks = []): void
    {
        $webhook = (string) Config::get('services.slack.webhook_url', '');
        if ($webhook === '') {
            throw new RuntimeException('Slack webhook_url not configured');
        }
        $payload = [
            'text' => $text,
            'channel' => $channel ?: Config::get('services.slack.default_channel'),
        ];
        if ($blocks !== []) {
            $payload['blocks'] = $blocks;
        }

        $attempt = 0;
        $last = null;
        while ($attempt < 2) {
            $attempt++;
            try {
                $response = Http::timeout(5)->post($webhook, $payload);
                if ($response->successful()) {
                    return;
                }
                $status = $response->status();
                if ($status >= 500 && $attempt < 2) {
                    $last = new RuntimeException("Slack 5xx: {$status}");
                    continue;
                }
                throw new RuntimeException("Slack HTTP {$status}: ".$response->body());
            } catch (RuntimeException $e) {
                throw $e;
            } catch (\Throwable $e) {
                // network/timeout: retry once
                $last = $e;
                if ($attempt >= 2) {
                    throw new RuntimeException('Slack request failed: '.$e->getMessage(), 0, $e);
                }
            }
        }
        if ($last) {
            throw new RuntimeException('Slack request failed: '.$last->getMessage(), 0, $last);
        }
    }
}
