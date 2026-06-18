<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\File;
use Tests\TestCase;

class LogCleanupCommandTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->deleteTestLogs();
    }

    protected function tearDown(): void
    {
        $this->deleteTestLogs();

        parent::tearDown();
    }

    public function test_logs_clear_deletes_log_files_older_than_seven_days_by_default(): void
    {
        $oldLog = $this->logFile('test-old-default.log', 2048, 8);
        $recentLog = $this->logFile('test-recent-default.log', 1024, 2);
        $oldNonLog = $this->nonLogFile('test-old-default.txt', 1024, 8);

        $this->artisan('logs:clear')
            ->expectsOutputToContain('Deleted')
            ->assertExitCode(0);

        $this->assertFileDoesNotExist($oldLog);
        $this->assertFileExists($oldNonLog);

        File::delete([$recentLog, $oldNonLog]);
    }

    public function test_logs_clear_days_option_overrides_retention_period(): void
    {
        $keptLog = $this->logFile('test-kept-override.log', 512, 10);
        $deletedLog = $this->logFile('test-deleted-override.log', 1024, 31);

        $this->artisan('logs:clear --days=30')
            ->expectsOutputToContain('Deleted')
            ->assertExitCode(0);

        $this->assertFileExists($keptLog);
        $this->assertFileDoesNotExist($deletedLog);

        File::delete($keptLog);
    }

    public function test_logs_clear_is_scheduled_daily_at_midnight(): void
    {
        $consoleRoutes = File::get(base_path('routes/console.php'));

        $this->assertStringContainsString("Schedule::command('logs:clear')->dailyAt('00:00')", $consoleRoutes);
    }

    private function logFile(string $name, int $bytes, int $ageInDays): string
    {
        return $this->datedFile($name, $bytes, $ageInDays);
    }

    private function nonLogFile(string $name, int $bytes, int $ageInDays): string
    {
        return $this->datedFile($name, $bytes, $ageInDays);
    }

    private function datedFile(string $name, int $bytes, int $ageInDays): string
    {
        $path = storage_path('logs/'.$name);

        File::ensureDirectoryExists(dirname($path));
        File::put($path, str_repeat('x', $bytes));
        touch($path, now()->subDays($ageInDays)->subMinute()->getTimestamp());

        return $path;
    }

    private function deleteTestLogs(): void
    {
        foreach (File::glob(storage_path('logs/*.log')) as $path) {
            if (is_file($path) && basename($path) !== 'laravel.log') {
                File::delete($path);
            }
        }
    }
}
