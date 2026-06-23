<?php

namespace Tests\Unit;

use App\Jobs\DispatchWebhookJob;
use PHPUnit\Framework\TestCase;

class WebhookRetryTest extends TestCase
{
    public function test_backoff_grows_exponentially_from_the_base_delay(): void
    {
        $this->assertSame(10, DispatchWebhookJob::backoffFor(1));
        $this->assertSame(20, DispatchWebhookJob::backoffFor(2));
        $this->assertSame(40, DispatchWebhookJob::backoffFor(3));
        $this->assertSame(80, DispatchWebhookJob::backoffFor(4));
        $this->assertSame(160, DispatchWebhookJob::backoffFor(5));
    }

    public function test_backoff_is_capped_at_the_max_delay(): void
    {
        $this->assertSame(
            DispatchWebhookJob::MAX_DELAY,
            DispatchWebhookJob::backoffFor(20)
        );
    }

    public function test_backoff_rejects_non_positive_attempts(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        DispatchWebhookJob::backoffFor(0);
    }

    public function test_schedule_has_one_interval_between_each_attempt(): void
    {
        $schedule = DispatchWebhookJob::backoffSchedule();

        $this->assertCount(DispatchWebhookJob::MAX_ATTEMPTS - 1, $schedule);
        $this->assertSame([10, 20, 40, 80], $schedule);
    }

    public function test_schedule_is_strictly_increasing(): void
    {
        $schedule = DispatchWebhookJob::backoffSchedule();

        $sorted = $schedule;
        sort($sorted);

        $this->assertSame($sorted, $schedule);
        $this->assertSame(count($schedule), count(array_unique($schedule)));
    }
}
