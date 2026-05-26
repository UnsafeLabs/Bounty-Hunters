<?php

namespace Tests\Feature;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

class LogCleanupCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        $this->deleteTestLogs();

        parent::tearDown();
    }

    public function test_logs_clear_deletes_logs_older_than_seven_days_by_default(): void
    {
        $oldLog = $this->writeLog('old-default.log', 2048, '-8 days');
        $recentLog = $this->writeLog('recent-default.log', 1024, '-6 days');

        $this->artisan('logs:clear')
            ->expectsOutput('Deleted 1 log file, freed 2 KB.')
            ->assertSuccessful();

        $this->assertFileDoesNotExist($oldLog);
        $this->assertFileExists($recentLog);
    }

    public function test_logs_clear_days_option_overrides_retention_window(): void
    {
        $oldLog = $this->writeLog('old-thirty-day.log', 1024, '-31 days');
        $keptLog = $this->writeLog('kept-thirty-day.log', 1024, '-29 days');

        $this->artisan('logs:clear', ['--days' => 30])
            ->expectsOutput('Deleted 1 log file, freed 1 KB.')
            ->assertSuccessful();

        $this->assertFileDoesNotExist($oldLog);
        $this->assertFileExists($keptLog);
    }

    public function test_logs_clear_is_scheduled_daily_at_midnight(): void
    {
        $events = app(Schedule::class)->events();

        $event = collect($events)->first(
            fn ($event) => str_contains($event->command ?? '', 'logs:clear')
        );

        $this->assertNotNull($event);
        $this->assertSame('0 0 * * *', $event->expression);
    }

    private function writeLog(string $name, int $bytes, string $modifiedAt): string
    {
        $path = storage_path("logs/test-{$name}");

        File::ensureDirectoryExists(dirname($path));
        File::put($path, str_repeat('x', $bytes));
        touch($path, strtotime($modifiedAt));

        return $path;
    }

    private function deleteTestLogs(): void
    {
        foreach (File::glob(storage_path('logs/test-*.log')) ?: [] as $path) {
            File::delete($path);
        }
    }
}
