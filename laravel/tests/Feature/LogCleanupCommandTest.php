<?php

namespace Tests\Feature;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

class LogCleanupCommandTest extends TestCase
{
    /**
     * @var array<int, string>
     */
    private array $createdLogFiles = [];

    protected function tearDown(): void
    {
        foreach ($this->createdLogFiles as $path) {
            File::delete($path);
        }

        parent::tearDown();
    }

    public function test_logs_clear_deletes_logs_older_than_default_retention(): void
    {
        $oldLog = $this->makeLogFile('codex-old-default.log', 8, str_repeat('a', 2048));
        $freshLog = $this->makeLogFile('codex-fresh-default.log', 3, 'fresh');

        $this->artisan('logs:clear')
            ->expectsOutput('Deleted 1 log file; freed 2 KB.')
            ->assertExitCode(0);

        $this->assertFileDoesNotExist($oldLog);
        $this->assertFileExists($freshLog);
    }

    public function test_logs_clear_days_option_overrides_default_retention(): void
    {
        $twentyDayLog = $this->makeLogFile('codex-retained-override.log', 20, 'keep me');

        $this->artisan('logs:clear --days=30')
            ->expectsOutput('Deleted 0 log files; freed 0 B.')
            ->assertExitCode(0);

        $this->assertFileExists($twentyDayLog);
    }

    public function test_log_cleanup_is_scheduled_daily_at_midnight(): void
    {
        $event = collect($this->app->make(Schedule::class)->events())
            ->first(fn ($event) => str_contains($event->command ?? '', 'logs:clear'));

        $this->assertNotNull($event);
        $this->assertSame('0 0 * * *', $event->getExpression());
    }

    private function makeLogFile(string $name, int $ageInDays, string $contents): string
    {
        $path = storage_path('logs/'.$name);

        File::ensureDirectoryExists(dirname($path));
        File::put($path, $contents);
        touch($path, now()->subDays($ageInDays)->getTimestamp());

        $this->createdLogFiles[] = $path;

        return $path;
    }
}
