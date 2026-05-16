<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;
use Tests\TestCase;
use Carbon\Carbon;

class LogsClearCommandTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $logsPath = storage_path('logs');
        if (!is_dir($logsPath)) {
            mkdir($logsPath, 0755, true);
        }
    }

    protected function tearDown(): void
    {
        $logsPath = storage_path('logs');
        foreach (glob($logsPath . '/test_*.log') ?: [] as $file) {
            if (is_file($file)) {
                @unlink($file);
            }
        }
        parent::tearDown();
    }

    public function test_logs_clear_deletes_logs_older_than_default_7_days(): void
    {
        $logPath = storage_path('logs/test_old.log');
        file_put_contents($logPath, "Old log entry\n");
        touch($logPath, Carbon::now()->subDays(10)->getTimestamp());

        $this->assertFileExists($logPath);

        $this->artisan('logs:clear')->assertSuccessful();

        $this->assertFileDoesNotExist($logPath);
    }

    public function test_logs_clear_keeps_logs_newer_than_retention(): void
    {
        $logPath = storage_path('logs/test_new.log');
        file_put_contents($logPath, "Recent log entry\n");
        touch($logPath, Carbon::now()->subDays(3)->getTimestamp());

        $this->artisan('logs:clear')->assertSuccessful();

        $this->assertFileExists($logPath);
        @unlink($logPath);
    }

    public function test_logs_clear_respects_custom_days_option(): void
    {
        $logPath = storage_path('logs/test_five_days.log');
        file_put_contents($logPath, "Five days old log\n");
        touch($logPath, Carbon::now()->subDays(5)->getTimestamp());

        // Kept with default 7 days
        $this->artisan('logs:clear')->assertSuccessful();
        $this->assertFileExists($logPath);

        // Deleted with --days=3
        $this->artisan('logs:clear', ['--days' => 3])->assertSuccessful();
        $this->assertFileDoesNotExist($logPath);
    }

    public function test_logs_clear_outputs_deleted_count_and_freed_space(): void
    {
        $logPath1 = storage_path('logs/test_space1.log');
        $logPath2 = storage_path('logs/test_space2.log');
        file_put_contents($logPath1, str_repeat("x", 1024));
        file_put_contents($logPath2, str_repeat("y", 2048));
        touch($logPath1, Carbon::now()->subDays(10)->getTimestamp());
        touch($logPath2, Carbon::now()->subDays(10)->getTimestamp());

        $this->artisan('logs:clear')->run();

        $output = Artisan::output();
        $this->assertStringContainsString('Deleted', $output);
        $this->assertStringContainsString('freed', $output);

        $this->assertFileDoesNotExist($logPath1);
        $this->assertFileDoesNotExist($logPath2);
    }

    public function test_logs_clear_handles_empty_directory(): void
    {
        $logsPath = storage_path('logs');
        foreach (glob($logsPath . '/*.log') ?: [] as $file) {
            if (is_file($file)) {
                @unlink($file);
            }
        }

        $this->artisan('logs:clear')->run();

        $output = Artisan::output();
        $this->assertStringContainsString('0', $output);
    }

    public function test_logs_clear_is_scheduled_daily_at_midnight(): void
    {
        $events = app()->bound('Illuminate\Console\Scheduling\Schedule')
            ? app('Illuminate\Console\Scheduling\Schedule')->events()
            : [];

        $found = false;
        foreach ($events as $event) {
            if (str_contains($event->command, 'logs:clear')) {
                $found = true;
                $this->assertStringContainsString('00:00', $event->expression);
                break;
            }
        }

        $this->assertTrue($found, 'logs:clear should be scheduled daily at 00:00');
    }
}
