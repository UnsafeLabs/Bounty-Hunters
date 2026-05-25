<?php

namespace Tests\Feature;

use App\Logging\StructuredJsonFormatter;
use Monolog\Level;
use Monolog\LogRecord;
use Tests\TestCase;

class LoggingConfigurationTest extends TestCase
{
    public function test_default_stack_writes_to_daily_and_error_channels(): void
    {
        $stack = config('logging.channels.stack');

        $this->assertSame(['daily', 'error'], $stack['channels']);
        $this->assertFalse($stack['ignore_exceptions']);
    }

    public function test_error_channel_targets_error_log_at_error_level(): void
    {
        $channel = config('logging.channels.error');

        $this->assertSame('single', $channel['driver']);
        $this->assertSame(storage_path('logs/error.log'), $channel['path']);
        $this->assertSame('error', $channel['level']);
        $this->assertTrue($channel['replace_placeholders']);
    }

    public function test_daily_channel_keeps_fourteen_days(): void
    {
        $daily = config('logging.channels.daily');

        $this->assertSame(14, $daily['days']);
        $this->assertSame(storage_path('logs/laravel.log'), $daily['path']);
    }

    public function test_json_channel_uses_structured_formatter(): void
    {
        $channel = config('logging.channels.json');

        $this->assertSame('monolog', $channel['driver']);
        $this->assertSame(storage_path('logs/laravel-json.log'), $channel['handler_with']['stream']);
        $this->assertSame(StructuredJsonFormatter::class, $channel['formatter']);
    }

    public function test_structured_json_formatter_outputs_required_fields(): void
    {
        $formatter = new StructuredJsonFormatter();
        $record = new LogRecord(
            datetime: new \DateTimeImmutable('2026-05-25T06:28:27Z'),
            channel: 'testing',
            level: Level::Error,
            message: 'Payment failed',
            context: ['invoice_id' => 123],
            extra: [],
        );

        $payload = json_decode($formatter->format($record), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame('2026-05-25T06:28:27+00:00', $payload['timestamp']);
        $this->assertSame('ERROR', $payload['level']);
        $this->assertSame('Payment failed', $payload['message']);
        $this->assertSame(['invoice_id' => 123], $payload['context']);
    }
}
