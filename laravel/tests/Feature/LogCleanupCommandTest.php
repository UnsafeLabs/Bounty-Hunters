<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\File;
use Tests\TestCase;

class LogCleanupCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        foreach (File::glob(storage_path('logs/test-cleanup-*.log')) ?: [] as $path) {
            File::delete($path);
        }

        parent::tearDown();
    }

    public function test_logs_clear_deletes_logs_older_than_seven_days_by_default(): void
    {
        $oldLog = $this->writeLogFile('test-cleanup-old.log', 'old log content', 8);
        $recentLog = $this->writeLogFile('test-cleanup-recent.log', 'recent log content', 2);

        $this->artisan('logs:clear')
            ->expectsOutputToContain('Deleted 1 log file(s)')
            ->expectsOutputToContain('freed')
            ->assertExitCode(0);

        $this->assertFileDoesNotExist($oldLog);
        $this->assertFileExists($recentLog);
    }

    public function test_logs_clear_days_option_overrides_default_retention(): void
    {
        $twentyDayLog = $this->writeLogFile('test-cleanup-20-days.log', 'twenty days', 20);
        $thirtyOneDayLog = $this->writeLogFile('test-cleanup-31-days.log', 'thirty one days', 31);

        $this->artisan('logs:clear', ['--days' => 30])
            ->expectsOutputToContain('Deleted 1 log file(s)')
            ->assertExitCode(0);

        $this->assertFileExists($twentyDayLog);
        $this->assertFileDoesNotExist($thirtyOneDayLog);
    }

    private function writeLogFile(string $name, string $contents, int $ageInDays): string
    {
        $path = storage_path("logs/{$name}");

        File::ensureDirectoryExists(dirname($path));
        File::put($path, $contents);
        touch($path, now()->subDays($ageInDays)->getTimestamp());

        return $path;
    }
}
