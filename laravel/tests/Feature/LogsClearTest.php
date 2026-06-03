<?php

namespace Tests\Feature;

use Tests\TestCase;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Console\Scheduling\Event;

class LogsClearTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // Clean up log directory before test
        $logPath = storage_path('logs');
        if (File::isDirectory($logPath)) {
            foreach (File::files($logPath) as $file) {
                if ($file->getExtension() === 'log' && $file->getFilename() !== '.gitignore') {
                    File::delete($file->getPathname());
                }
            }
        } else {
            File::makeDirectory($logPath, 0755, true);
        }
    }

    public function test_logs_clear_deletes_old_logs_by_default()
    {
        $logPath = storage_path('logs');
        
        // 1. Create a log file that is 8 days old
        $oldFile = $logPath . '/old_test.log';
        File::put($oldFile, str_repeat('A', 1024)); // 1 KB
        touch($oldFile, time() - (8 * 24 * 60 * 60)); // 8 days ago

        // 2. Create a log file that is 6 days old
        $newFile = $logPath . '/new_test.log';
        File::put($newFile, str_repeat('B', 2048)); // 2 KB
        touch($newFile, time() - (6 * 24 * 60 * 60)); // 6 days ago

        // Run the command
        Artisan::call('logs:clear');
        $output = Artisan::output();

        $this->assertStringContainsString('Deleted 1 log files', $output);
        $this->assertStringContainsString('Total space freed: 1 KB', $output);

        // Verify old file is deleted, new file is kept
        $this->assertFileDoesNotExist($oldFile);
        $this->assertFileExists($newFile);
    }

    public function test_logs_clear_with_custom_days()
    {
        $logPath = storage_path('logs');

        // Create a log file that is 31 days old
        $veryOldFile = $logPath . '/very_old_test.log';
        File::put($veryOldFile, str_repeat('A', 1024)); // 1 KB
        touch($veryOldFile, time() - (31 * 24 * 60 * 60)); // 31 days ago

        // Create a log file that is 15 days old
        $midOldFile = $logPath . '/mid_old_test.log';
        File::put($midOldFile, str_repeat('B', 1024)); // 1 KB
        touch($midOldFile, time() - (15 * 24 * 60 * 60)); // 15 days ago

        // Run the command with --days=30
        Artisan::call('logs:clear', ['--days' => 30]);
        $output = Artisan::output();

        $this->assertStringContainsString('Deleted 1 log files', $output);

        $this->assertFileDoesNotExist($veryOldFile);
        $this->assertFileExists($midOldFile);
    }

    public function test_logs_clear_schedule_registration()
    {
        $schedule = app(Schedule::class);
        $events = collect($schedule->events());

        // Find event that runs logs:clear
        $logClearEvent = $events->first(function (Event $event) {
            return str_contains($event->command, 'logs:clear');
        });

        $this->assertNotNull($logClearEvent, 'logs:clear scheduled event not found');
        $this->assertEquals('0 0 * * *', $logClearEvent->expression);
    }
}
