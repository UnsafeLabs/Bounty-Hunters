<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;

class SlackNotifier
{
    protected string $webhookUrl;
    protected string $defaultChannel;

    public function __construct()
    {
        $this->webhookUrl = config('services.slack.webhook_url', '');
        $this->defaultChannel = config('services.slack.default_channel', '#general');
    }

    /**
     * Send a message to Slack.
     *
     * @param string $message
     * @param string|null $channel Override the default channel
     * @param array|null $attachments Optional attachment blocks
     * @return array
     * @throws ConnectionException|RequestException
     */
    public function send(string $message, ?string $channel = null, ?array $attachments = null): array
    {
        $payload = [
            'channel' => $channel ?? $this->defaultChannel,
            'text' => $message,
        ];

        if ($attachments !== null) {
            $payload['attachments'] = $attachments;
        }

        try {
            $response = Http::timeout(5)
                ->retry(1, function (int $attempt, \Exception $exception) {
                    if ($exception instanceof RequestException) {
                        $status = $exception->response->status();
                        // Only retry on 5xx, not 4xx
                        return $status >= 500;
                    }
                    return false;
                })
                ->post($this->webhookUrl, $payload);

            $response->throwUnlessStatus(200);

            return $response->json() ?? [];
        } catch (RequestException $e) {
            // 4xx errors throw immediately (no retry)
            throw $e;
        }
    }

    /**
     * Facade-style static convenience method.
     *
     * @param string $message
     * @param string|null $channel
     * @param array|null $attachments
     * @return array
     */
    public static function send(string $message, ?string $channel = null, ?array $attachments = null): array
    {
        $instance = new static();
        return $instance->send($message, $channel, $attachments);
    }
}
