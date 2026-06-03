<?php

namespace Tests\Feature;

use Tests\TestCase;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\File;

class LoggingTest extends TestCase
{
    protected string $dailyLogPath;
    protected string $errorLogPath;
    protected string $jsonLogPath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->dailyLogPath = storage_path('logs/laravel-' . date('Y-m-d') . '.log');
        $this->errorLogPath = storage_path('logs/error.log');
        $this->jsonLogPath = storage_path('logs/laravel-json.log');

        // Clean up before test
        $this->clearLogs();
    }

    protected function tearDown(): void
    {
        // Clean up after test
        $this->clearLogs();

        parent::tearDown();
    }

    protected function clearLogs(): void
    {
        foreach ([$this->dailyLogPath, $this->errorLogPath, $this->jsonLogPath] as $path) {
            if (File::exists($path)) {
                File::delete($path);
            }
        }
    }

    public function test_info_log_is_routed_to_daily_but_not_error_log(): void
    {
        Log::info('This is an info test message');

        $this->assertTrue(File::exists($this->dailyLogPath), 'Daily log file does not exist');
        $this->assertFalse(File::exists($this->errorLogPath), 'Error log file should not exist for info level');

        $dailyContent = File::get($this->dailyLogPath);
        $this->assertStringContainsString('This is an info test message', $dailyContent);
    }

    public function test_error_log_is_routed_to_both_daily_and_error_log(): void
    {
        Log::error('This is an error test message');

        $this->assertTrue(File::exists($this->dailyLogPath), 'Daily log file does not exist');
        $this->assertTrue(File::exists($this->errorLogPath), 'Error log file does not exist');

        $dailyContent = File::get($this->dailyLogPath);
        $errorContent = File::get($this->errorLogPath);

        $this->assertStringContainsString('This is an error test message', $dailyContent);
        $this->assertStringContainsString('This is an error test message', $errorContent);
    }

    public function test_json_channel_outputs_valid_structured_json(): void
    {
        Log::channel('json')->info('This is a json test message', ['user_id' => 123]);

        $this->assertTrue(File::exists($this->jsonLogPath), 'JSON log file does not exist');

        $content = trim(File::get($this->jsonLogPath));
        $data = json_decode($content, true);

        $this->assertNotNull($data, 'JSON decoding failed');
        $this->assertArrayHasKey('timestamp', $data);
        $this->assertArrayHasKey('level', $data);
        $this->assertArrayHasKey('message', $data);
        $this->assertArrayHasKey('context', $data);

        $this->assertEquals('INFO', $data['level']);
        $this->assertEquals('This is a json test message', $data['message']);
        $this->assertEquals(['user_id' => 123], $data['context']);
    }
}
