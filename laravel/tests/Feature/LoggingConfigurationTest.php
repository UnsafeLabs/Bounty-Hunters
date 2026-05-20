<?php

namespace Tests\Feature;

use App\Logging\StructuredJsonFormatter;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class LoggingConfigurationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->clearTestLogs();
    }

    protected function tearDown(): void
    {
        $this->clearTestLogs();

        parent::tearDown();
    }

    private function clearTestLogs(): void
    {
        foreach ([
            storage_path('logs/error.log'),
            storage_path('logs/laravel.json.log'),
            storage_path('logs/laravel.log'),
        ] as $path) {
            if (file_exists($path)) {
                unlink($path);
            }
        }

        foreach (glob(storage_path('logs/laravel-*.log')) ?: [] as $path) {
            unlink($path);
        }
    }

    public function test_default_stack_writes_daily_and_error_channels(): void
    {
        $stack = config('logging.channels.stack');

        $this->assertSame('stack', $stack['driver']);
        $this->assertSame(['daily', 'error'], $stack['channels']);
    }

    public function test_daily_channel_keeps_fourteen_days(): void
    {
        $daily = config('logging.channels.daily');

        $this->assertSame('daily', $daily['driver']);
        $this->assertSame(14, $daily['days']);
    }

    public function test_error_channel_writes_error_level_and_above_to_error_log(): void
    {
        $error = config('logging.channels.error');

        $this->assertSame('single', $error['driver']);
        $this->assertSame(storage_path('logs/error.log'), $error['path']);
        $this->assertSame('error', $error['level']);
    }

    public function test_json_channel_uses_structured_formatter(): void
    {
        $json = config('logging.channels.json');

        $this->assertSame('monolog', $json['driver']);
        $this->assertSame(StructuredJsonFormatter::class, $json['formatter']);
        $this->assertSame(storage_path('logs/laravel.json.log'), $json['handler_with']['stream']);
    }

    public function test_info_messages_stay_out_of_error_log(): void
    {
        Log::channel('stack')->info('visible only in daily log');

        $this->assertStringContainsString('visible only in daily log', $this->dailyLogContents());
        $this->assertFileDoesNotExist(storage_path('logs/error.log'));
    }

    public function test_error_messages_are_written_to_daily_and_error_logs(): void
    {
        Log::channel('stack')->error('visible in both logs');

        $this->assertFileExists(storage_path('logs/error.log'));
        $this->assertStringContainsString('visible in both logs', $this->dailyLogContents());
        $this->assertStringContainsString('visible in both logs', file_get_contents(storage_path('logs/error.log')));
    }

    public function test_json_channel_writes_expected_fields(): void
    {
        Log::channel('json')->warning('structured event', ['request_id' => 'abc-123']);

        $line = trim(file_get_contents(storage_path('logs/laravel.json.log')));
        $payload = json_decode($line, true);

        $this->assertIsArray($payload);
        $this->assertArrayHasKey('timestamp', $payload);
        $this->assertSame('WARNING', $payload['level']);
        $this->assertSame('structured event', $payload['message']);
        $this->assertSame(['request_id' => 'abc-123'], $payload['context']);
    }

    private function dailyLogContents(): string
    {
        $matches = glob(storage_path('logs/laravel-*.log')) ?: [];

        $this->assertNotEmpty($matches);

        return file_get_contents($matches[0]);
    }
}
