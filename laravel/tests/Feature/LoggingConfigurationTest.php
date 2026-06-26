<?php

namespace Tests\Feature;

use App\Logging\JsonLogFormatter;
use DateTimeImmutable;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Monolog\Level;
use Monolog\LogRecord;
use Tests\TestCase;

class LoggingConfigurationTest extends TestCase
{
    public function test_logging_stack_and_channels_are_configured(): void
    {
        $this->assertSame(['daily', 'error'], config('logging.channels.stack.channels'));
        $this->assertSame(14, (int) config('logging.channels.daily.days'));
        $this->assertSame(storage_path('logs/error.log'), config('logging.channels.error.path'));
        $this->assertSame('error', config('logging.channels.error.level'));
        $this->assertSame(JsonLogFormatter::class, config('logging.channels.json.formatter'));
        $this->assertSame(storage_path('logs/structured.log'), config('logging.channels.json.handler_with.stream'));
    }

    public function test_error_messages_are_duplicated_to_error_log_but_info_messages_are_not(): void
    {
        $dailyPath = storage_path('logs/test-laravel.log');
        $datedDailyPath = storage_path('logs/test-laravel-'.date('Y-m-d').'.log');
        $errorPath = storage_path('logs/test-error.log');

        File::delete([$dailyPath, $datedDailyPath, $errorPath]);

        config([
            'logging.channels.daily.path' => $dailyPath,
            'logging.channels.error.path' => $errorPath,
        ]);

        Log::forgetChannel('stack');
        Log::forgetChannel('daily');
        Log::forgetChannel('error');

        Log::channel('stack')->info('general log entry');
        Log::channel('stack')->error('error log entry');

        $dailyContents = File::get($datedDailyPath);
        $errorContents = File::get($errorPath);

        $this->assertStringContainsString('general log entry', $dailyContents);
        $this->assertStringContainsString('error log entry', $dailyContents);
        $this->assertStringNotContainsString('general log entry', $errorContents);
        $this->assertStringContainsString('error log entry', $errorContents);

        File::delete([$dailyPath, $datedDailyPath, $errorPath]);
    }

    public function test_json_formatter_outputs_required_structured_fields(): void
    {
        $formatter = new JsonLogFormatter();

        $line = $formatter->format(new LogRecord(
            datetime: new DateTimeImmutable('2026-06-26T00:00:00+00:00'),
            channel: 'testing',
            level: Level::Warning,
            message: 'Structured log message',
            context: ['request_id' => 'req_123'],
            extra: [],
        ));

        $payload = json_decode($line, true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame('2026-06-26T00:00:00+00:00', $payload['timestamp']);
        $this->assertSame('WARNING', $payload['level']);
        $this->assertSame('Structured log message', $payload['message']);
        $this->assertSame(['request_id' => 'req_123'], $payload['context']);
    }
}
