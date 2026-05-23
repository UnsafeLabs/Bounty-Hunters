<?php

namespace Tests\Feature;

use Tests\TestCase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;

class ConsoleCommandTest extends TestCase
{
    public function test_logs_clear_command()
    {
        // Setup dummy log files
        $logPath = storage_path('logs');
        if (!File::exists($logPath)) {
            File::makeDirectory($logPath);
        }

        $oldFile = $logPath . '/old_log.log';
        $newFile = $logPath . '/new_log.log';

        File::put($oldFile, 'old data');
        File::put($newFile, 'new data');

        // Modify old file's modified time to 10 days ago
        touch($oldFile, time() - (10 * 86400));
        // Modify new file's modified time to today
        touch($newFile, time());

        // Run the command
        Artisan::call('logs:clear');
        $output = Artisan::output();

        $this->assertStringContainsString('deleted', $output);
        
        // Old file should be deleted, new file should remain
        $this->assertFalse(File::exists($oldFile));
        $this->assertTrue(File::exists($newFile));
        
        // Cleanup
        if (File::exists($newFile)) {
            File::delete($newFile);
        }
    }
}
