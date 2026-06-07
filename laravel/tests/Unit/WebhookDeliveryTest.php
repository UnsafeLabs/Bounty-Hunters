<?php

namespace Tests\Unit;

use App\Models\WebhookDelivery;
use Illuminate\Support\Carbon;
use PHPUnit\Framework\TestCase;

class WebhookDeliveryTest extends TestCase
{
    public function test_failed_pending_delivery_should_retry_before_max_attempts(): void
    {
        $delivery = new WebhookDelivery([
            'attempts' => 2,
            'next_retry_at' => Carbon::now()->addMinute(),
        ]);

        $this->assertTrue($delivery->shouldRetry(5));
    }

    public function test_delivered_or_exhausted_delivery_should_not_retry(): void
    {
        $delivered = new WebhookDelivery([
            'attempts' => 2,
            'next_retry_at' => Carbon::now()->addMinute(),
            'delivered_at' => Carbon::now(),
        ]);
        $exhausted = new WebhookDelivery([
            'attempts' => 5,
            'next_retry_at' => Carbon::now()->addMinute(),
        ]);

        $this->assertFalse($delivered->shouldRetry(5));
        $this->assertFalse($exhausted->shouldRetry(5));
    }
}
