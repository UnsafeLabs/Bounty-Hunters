<?php

namespace Tests\Feature;

use App\Logging\StructuredJsonFormatter;
use DateTimeImmutable;
use Monolog\Handler\StreamHandler;
use Monolog\Level;
use Monolog\LogRecord;
use Tests\TestCase;

class LoggingConfigTest extends TestCase
{
    public function test_default_stack_writes_to_daily_and_error_logs(): void
    {
        $this->assertSame(['daily', 'error'], config('logging.channels.stack.channels'));
    }

    public function test_daily_log_retention_keeps_fourteen_days(): void
    {
        $this->assertSame(14, config('logging.channels.daily.days'));
    }

    public function test_error_channel_writes_only_error_and_above_to_error_log(): void
    {
        $channel = config('logging.channels.error');

        $this->assertSame('daily', $channel['driver']);
        $this->assertSame(storage_path('logs/error.log'), $channel['path']);
        $this->assertSame('error', $channel['level']);
        $this->assertSame(14, $channel['days']);
    }

    public function test_json_channel_uses_structured_formatter(): void
    {
        $channel = config('logging.channels.json');

        $this->assertSame('monolog', $channel['driver']);
        $this->assertSame(StreamHandler::class, $channel['handler']);
        $this->assertSame(storage_path('logs/json.log'), $channel['handler_with']['stream']);
        $this->assertSame(StructuredJsonFormatter::class, $channel['formatter']);
    }

    public function test_structured_json_formatter_outputs_required_fields(): void
    {
        $formatter = new StructuredJsonFormatter();
        $record = new LogRecord(
            datetime: new DateTimeImmutable('2026-06-12T12:00:00+00:00'),
            channel: 'testing',
            level: Level::Error,
            message: 'Something failed',
            context: ['job_id' => 123],
            extra: [],
        );

        $payload = json_decode($formatter->format($record), true);

        $this->assertIsArray($payload);
        $this->assertArrayHasKey('timestamp', $payload);
        $this->assertSame('ERROR', $payload['level']);
        $this->assertSame('Something failed', $payload['message']);
        $this->assertSame(['job_id' => 123], $payload['context']);
    }
}
