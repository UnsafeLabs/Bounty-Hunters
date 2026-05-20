<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Artisan as ArtisanFacade;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;
use Symfony\Component\Console\Command\Command;
use Tests\TestCase;

class LogsClearCommandTest extends TestCase
{
    private array $testLogs = [];

    protected function tearDown(): void
    {
        foreach ($this->testLogs as $path) {
            if (File::exists($path)) {
                File::delete($path);
            }
        }

        parent::tearDown();
    }

    public function test_logs_clear_deletes_logs_older_than_seven_days_by_default(): void
    {
        $oldLog = $this->makeLog('old-default.log', 'old log contents', 8);
        $freshLog = $this->makeLog('fresh-default.log', 'fresh log contents', 6);

        $exitCode = ArtisanFacade::call('logs:clear');

        $this->assertSame(Command::SUCCESS, $exitCode);
        $this->assertFileDoesNotExist($oldLog);
        $this->assertFileExists($freshLog);
        $this->assertStringContainsString('Deleted 1 log file', ArtisanFacade::output());
        $this->assertStringContainsString('freed', ArtisanFacade::output());
    }

    public function test_days_option_overrides_default_retention(): void
    {
        $olderThanThirtyDays = $this->makeLog('old-custom-days.log', 'remove me', 31);
        $withinThirtyDays = $this->makeLog('fresh-custom-days.log', 'keep me', 29);

        $exitCode = ArtisanFacade::call('logs:clear', ['--days' => 30]);

        $this->assertSame(Command::SUCCESS, $exitCode);
        $this->assertFileDoesNotExist($olderThanThirtyDays);
        $this->assertFileExists($withinThirtyDays);
    }

    public function test_logs_clear_ignores_non_log_files(): void
    {
        $oldLog = $this->makeLog('old-log-file.log', 'remove me', 8);
        $oldTextFile = $this->makeLog('old-text-file.txt', 'keep me', 30);

        $exitCode = ArtisanFacade::call('logs:clear');

        $this->assertSame(Command::SUCCESS, $exitCode);
        $this->assertFileDoesNotExist($oldLog);
        $this->assertFileExists($oldTextFile);
    }

    public function test_negative_days_option_fails_without_deleting_logs(): void
    {
        $oldLog = $this->makeLog('old-negative-days.log', 'keep me', 30);

        $exitCode = ArtisanFacade::call('logs:clear', ['--days' => -1]);

        $this->assertSame(Command::FAILURE, $exitCode);
        $this->assertFileExists($oldLog);
        $this->assertStringContainsString('must be zero or greater', ArtisanFacade::output());
    }

    public function test_logs_clear_is_scheduled_daily_at_midnight(): void
    {
        $matchingEvent = collect(Schedule::events())->first(function ($event): bool {
            return str_contains((string) $event->command, 'logs:clear')
                && $event->expression === '0 0 * * *';
        });

        $this->assertNotNull($matchingEvent);
    }

    private function makeLog(string $name, string $contents, int $ageInDays): string
    {
        $path = storage_path('logs/'.$name);

        File::ensureDirectoryExists(dirname($path));
        File::put($path, $contents);
        touch($path, now()->subDays($ageInDays)->getTimestamp());

        $this->testLogs[] = $path;

        return $path;
    }
}
