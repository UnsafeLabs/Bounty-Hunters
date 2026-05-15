<?php

namespace Tests\Feature;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

class LogCleanupCommandTest extends TestCase
{
    private string $logsPath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->logsPath = storage_path('logs');
        File::ensureDirectoryExists($this->logsPath);
        $this->deleteTestFiles();
    }

    protected function tearDown(): void
    {
        $this->deleteTestFiles();

        parent::tearDown();
    }

    public function test_it_deletes_log_files_older_than_seven_days_by_default(): void
    {
        $oldLog = $this->logFile('log-cleanup-test-old.log', 10, 8);
        $recentLog = $this->logFile('log-cleanup-test-recent.log', 10, 2);
        $ignoredFile = $this->logFile('log-cleanup-test-notes.txt', 10, 30);

        $this->artisan('logs:clear')
            ->expectsOutput('Deleted 1 log file; freed 10 B.')
            ->assertSuccessful();

        $this->assertFileDoesNotExist($oldLog);
        $this->assertFileExists($recentLog);
        $this->assertFileExists($ignoredFile);
    }

    public function test_days_option_overrides_retention_period(): void
    {
        $eightDayLog = $this->logFile('log-cleanup-test-eight-days.log', 10, 8);
        $thirtyOneDayLog = $this->logFile('log-cleanup-test-thirty-one-days.log', 10, 31);

        $this->artisan('logs:clear --days=30')
            ->expectsOutput('Deleted 1 log file; freed 10 B.')
            ->assertSuccessful();

        $this->assertFileExists($eightDayLog);
        $this->assertFileDoesNotExist($thirtyOneDayLog);
    }

    public function test_days_option_must_be_non_negative_integer(): void
    {
        $this->artisan('logs:clear --days=-1')
            ->expectsOutput('The --days option must be a non-negative integer.')
            ->assertExitCode(1);
    }

    public function test_log_cleanup_is_scheduled_daily_at_midnight(): void
    {
        $events = app(Schedule::class)->events();

        $this->assertTrue(collect($events)->contains(function ($event) {
            return str_contains($event->command, 'logs:clear')
                && $event->expression === '0 0 * * *';
        }));
    }

    private function logFile(string $name, int $bytes, int $ageInDays): string
    {
        $path = $this->logsPath.'/'.$name;

        File::put($path, str_repeat('x', $bytes));
        touch($path, now()->subDays($ageInDays)->getTimestamp());

        return $path;
    }

    private function deleteTestFiles(): void
    {
        foreach (File::glob($this->logsPath.'/log-cleanup-test-*') as $path) {
            File::delete($path);
        }
    }
}
