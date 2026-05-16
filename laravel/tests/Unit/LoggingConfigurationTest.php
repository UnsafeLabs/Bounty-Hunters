<?php

namespace Tests\Unit;

use App\Logging\JsonLogFormatter;
use Monolog\Handler\StreamHandler;
use Monolog\Level;
use Monolog\LogRecord;
use Tests\TestCase;

class LoggingConfigurationTest extends TestCase
{
    public function test_stack_sends_general_and_error_logs_to_separate_channels(): void
    {
        $channels = config('logging.channels');

        $this->assertSame(['daily', 'error'], $channels['stack']['channels']);
        $this->assertSame('daily', $channels['daily']['driver']);
        $this->assertSame(14, $channels['daily']['days']);
        $this->assertSame('single', $channels['error']['driver']);
        $this->assertSame(storage_path('logs/error.log'), $channels['error']['path']);
        $this->assertSame('error', $channels['error']['level']);
    }

    public function test_json_channel_uses_structured_formatter(): void
    {
        $channel = config('logging.channels.json');

        $this->assertSame('monolog', $channel['driver']);
        $this->assertSame(StreamHandler::class, $channel['handler']);
        $this->assertSame(storage_path('logs/laravel-json.log'), $channel['handler_with']['stream']);
        $this->assertSame(JsonLogFormatter::class, $channel['formatter']);
    }

    public function test_json_formatter_outputs_required_fields(): void
    {
        $formatter = new JsonLogFormatter();
        $record = new LogRecord(
            datetime: new \DateTimeImmutable('2026-05-16T03:55:00+00:00'),
            channel: 'testing',
            level: Level::Error,
            message: 'Payment failed',
            context: ['order_id' => 123],
            extra: [],
        );

        $decoded = json_decode($formatter->format($record), true);

        $this->assertSame('2026-05-16T03:55:00+00:00', $decoded['timestamp']);
        $this->assertSame('ERROR', $decoded['level']);
        $this->assertSame('Payment failed', $decoded['message']);
        $this->assertSame(['order_id' => 123], $decoded['context']);
    }
}
