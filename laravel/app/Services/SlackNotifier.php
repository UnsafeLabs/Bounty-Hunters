<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class SlackNotifier
{
    protected string $webhookUrl;
    protected string $defaultChannel;

    public function __construct()
    {
        $this->webhookUrl = config("services.slack.webhook_url", "");
        $this->defaultChannel = config("services.slack.default_channel", "#general");
    }

    public static function send(string $message, ?string $channel = null, array $blocks = []): bool
    {
        $notifier = new self();
        return $notifier->sendMessage($message, $channel, $blocks);
    }

    public function sendMessage(string $message, ?string $channel = null, array $blocks = []): bool
    {
        if (empty($this->webhookUrl)) {
            Log::warning("Slack webhook URL not configured");
            return false;
        }

        $payload = [
            "text" => $message,
            "channel" => $channel ?? $this->defaultChannel,
        ];

        if (!empty($blocks)) {
            $payload["blocks"] = $blocks;
        }

        try {
            $response = Http::timeout(5)->retry(1, 100, function ($exception, $request) {
                return $exception->response && $exception->response->status() >= 500;
            })->post($this->webhookUrl, $payload);

            if ($response->status() >= 400 && $response->status() < 500) {
                Log::error("Slack webhook returned 4xx", [
                    "status" => $response->status(),
                    "body" => $response->body(),
                ]);
                return false;
            }

            if (!$response->successful()) {
                Log::error("Slack webhook failed after retry", [
                    "status" => $response->status(),
                ]);
                return false;
            }

            return true;
        } catch (\Exception $e) {
            Log::error("Slack notifier exception: ".$e->getMessage());
            return false;
        }
    }
}
