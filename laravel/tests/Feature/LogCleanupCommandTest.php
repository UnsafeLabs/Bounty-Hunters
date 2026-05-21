<?php

namespace Tests\Feature;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class LogCleanupCommandTest extends TestCase
{
    private array $testLogFiles = [
        'old-default-test.log',
        'new-default-test.log',
        'eight-day-override-test.log',
    ];

    protected function tearDown(): void
    {
        foreach ($this->testLogFiles as $file) {
            @unlink(storage_path('logs/' . $file));
        }

        parent::tearDown();
    }

    public function test_it_deletes_logs_older_than_seven_days_by_default(): void
    {
        $oldLog = storage_path('logs/old-default-test.log');
        $newLog = storage_path('logs/new-default-test.log');

        $this->writeLogFile($oldLog, 'old default test log');
        $this->writeLogFile($newLog, 'new default test log');

        touch($oldLog, now()->subDays(8)->getTimestamp());
        touch($newLog, now()->subDay()->getTimestamp());

        $exitCode = Artisan::call('logs:clear');
        $output = Artisan::output();

        $this->assertSame(0, $exitCode);
        $this->assertFalse(file_exists($oldLog));
        $this->assertTrue(file_exists($newLog));
        $this->assertTrue(file_exists(storage_path('logs/.gitignore')));
        $this->assertStringContainsString('Deleted 1 log file(s).', $output);
        $this->assertStringContainsString('Freed ', $output);
    }

    public function test_days_option_overrides_default_retention_period(): void
    {
        $log = storage_path('logs/eight-day-override-test.log');

        $this->writeLogFile($log, 'override test log');
        touch($log, now()->subDays(8)->getTimestamp());

        $exitCode = Artisan::call('logs:clear', ['--days' => 30]);
        $output = Artisan::output();

        $this->assertSame(0, $exitCode);
        $this->assertTrue(file_exists($log));
        $this->assertStringContainsString('Deleted 0 log file(s).', $output);
    }

    public function test_it_rejects_negative_days_option(): void
    {
        $exitCode = Artisan::call('logs:clear', ['--days' => -1]);
        $output = Artisan::output();

        $this->assertSame(1, $exitCode);
        $this->assertStringContainsString('The --days option must be zero or greater.', $output);
    }

    public function test_it_registers_daily_midnight_schedule(): void
    {
        $schedule = $this->app->make(Schedule::class);

        $event = collect($schedule->events())->first(function ($event) {
            return str_contains($event->getSummaryForDisplay(), 'logs:clear');
        });

        $this->assertNotNull($event);
        $this->assertSame('0 0 * * *', $event->expression);
    }

    private function writeLogFile(string $path, string $contents): void
    {
        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0777, true);
        }

        file_put_contents($path, $contents);
    }
}