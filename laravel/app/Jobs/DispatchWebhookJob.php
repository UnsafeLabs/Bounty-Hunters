<?php

namespace App\Jobs;

use App\Models\WebhookDelivery;
use App\Services\WebhookDispatcher;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class DispatchWebhookJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * The maximum number of delivery attempts.
     */
    public const MAX_ATTEMPTS = 5;

    /**
     * The base delay, in seconds, for the exponential backoff.
     */
    public const BASE_DELAY = 10;

    /**
     * The ceiling, in seconds, for any single backoff interval.
     */
    public const MAX_DELAY = 3600;

    /**
     * The number of times the job may be attempted.
     */
    public int $tries = self::MAX_ATTEMPTS;

    public function __construct(public int $deliveryId)
    {
    }

    /**
     * Deliver the webhook payload.
     */
    public function handle(WebhookDispatcher $dispatcher): void
    {
        $delivery = WebhookDelivery::with('webhook')->find($this->deliveryId);

        if ($delivery === null || $delivery->wasDelivered()) {
            return;
        }

        $dispatcher->send($delivery);
    }

    /**
     * The number of seconds to wait before each retry.
     *
     * @return array<int, int>
     */
    public function backoff(): array
    {
        return self::backoffSchedule();
    }

    /**
     * The full exponential-backoff schedule between attempts, in seconds.
     *
     * There is one interval between each pair of attempts, so a job allowed
     * MAX_ATTEMPTS tries has MAX_ATTEMPTS - 1 waiting periods.
     *
     * @return array<int, int>
     */
    public static function backoffSchedule(): array
    {
        $schedule = [];

        for ($attempt = 1; $attempt < self::MAX_ATTEMPTS; $attempt++) {
            $schedule[] = self::backoffFor($attempt);
        }

        return $schedule;
    }

    /**
     * The exponential backoff, in seconds, after the given (1-based) attempt.
     *
     * Delay doubles per attempt (BASE_DELAY * 2^(attempt-1)) and is capped at
     * MAX_DELAY so retries never wait longer than the configured ceiling.
     */
    public static function backoffFor(int $attempt): int
    {
        if ($attempt < 1) {
            throw new \InvalidArgumentException('Attempt must be a positive integer.');
        }

        $delay = self::BASE_DELAY * (2 ** ($attempt - 1));

        return (int) min($delay, self::MAX_DELAY);
    }
}
