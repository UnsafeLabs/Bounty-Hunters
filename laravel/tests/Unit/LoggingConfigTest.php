<?php

namespace Tests\Unit;

use App\Logging\JsonLogFormatter;
use DateTimeImmutable;
use Monolog\Level;
use Monolog\LogRecord;
use Tests\TestCase;

class LoggingConfigTest extends TestCase
{
    public function test_stack_writes_to_daily_and_error_logs_by_default(): void
    {
        $stack = config('logging.channels.stack');

        $this->assertSame('stack', $stack['driver']);
        $this->assertSame(['daily', 'error'], $stack['channels']);
        $this->assertFalse($stack['ignore_exceptions']);
    }

    public function test_error_channel_writes_only_error_and_above_to_error_log(): void
    {
        $error = config('logging.channels.error');

        $this->assertSame('single', $error['driver']);
        $this->assertStringEndsWith('storage/logs/error.log', $error['path']);
        $this->assertSame('error', $error['level']);
        $this->assertTrue($error['replace_placeholders']);
    }

    public function test_daily_channel_keeps_fourteen_days(): void
    {
        $this->assertEquals(14, config('logging.channels.daily.days'));
    }

    public function test_json_channel_uses_structured_formatter(): void
    {
        $json = config('logging.channels.json');

        $this->assertSame('monolog', $json['driver']);
        $this->assertSame(JsonLogFormatter::class, $json['formatter']);
        $this->assertStringEndsWith('storage/logs/laravel-json.log', $json['handler_with']['stream']);
    }

    public function test_json_formatter_outputs_required_fields(): void
    {
        $formatter = new JsonLogFormatter();
        $record = new LogRecord(
            new DateTimeImmutable('2026-06-05T00:00:00+00:00'),
            'testing',
            Level::Error,
            'Failed to process webhook',
            ['request_id' => 'abc123'],
            [],
        );

        $payload = json_decode($formatter->format($record), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame('2026-06-05T00:00:00+00:00', $payload['timestamp']);
        $this->assertSame('ERROR', $payload['level']);
        $this->assertSame('Failed to process webhook', $payload['message']);
        $this->assertSame(['request_id' => 'abc123'], $payload['context']);
    }
}
