<?php

namespace Tests\Unit;

use App\Logging\JsonLogFormatter;
use DateTimeImmutable;
use Monolog\Handler\StreamHandler;
use Monolog\Level;
use Monolog\LogRecord;
use Tests\TestCase;

class LoggingConfigurationTest extends TestCase
{
    public function test_stack_channel_sends_logs_to_daily_and_error_channels(): void
    {
        $this->assertSame(['daily', 'error'], config('logging.channels.stack.channels'));
    }

    public function test_daily_and_error_channels_use_expected_retention_and_levels(): void
    {
        $this->assertSame(14, config('logging.channels.daily.days'));
        $this->assertSame('error', config('logging.channels.error.level'));
        $this->assertStringEndsWith('logs/error.log', config('logging.channels.error.path'));
    }

    public function test_json_channel_uses_structured_formatter(): void
    {
        $this->assertSame('monolog', config('logging.channels.json.driver'));
        $this->assertSame(StreamHandler::class, config('logging.channels.json.handler'));
        $this->assertSame(JsonLogFormatter::class, config('logging.channels.json.formatter'));
    }

    public function test_json_formatter_outputs_required_fields(): void
    {
        $formatter = new JsonLogFormatter();
        $record = new LogRecord(
            datetime: new DateTimeImmutable('2026-06-29T00:00:00+00:00'),
            channel: 'testing',
            level: Level::Info,
            message: 'User updated profile',
            context: ['user_id' => 123],
        );

        $formatted = json_decode($formatter->format($record), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame('2026-06-29T00:00:00+00:00', $formatted['timestamp']);
        $this->assertSame('INFO', $formatted['level']);
        $this->assertSame('User updated profile', $formatted['message']);
        $this->assertSame(['user_id' => 123], $formatted['context']);
    }
}
