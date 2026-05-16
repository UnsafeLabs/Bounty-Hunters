<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Number of days to keep logs}', function () {
    $days = (int) $this->option('days');
    $logPath = storage_path('logs');
    
    if (!is_dir($logPath)) {
        $this->error('Log directory not found: ' . $logPath);
        return 1;
    }
    
    $files = glob($logPath . '/*.log');
    $cutoffTime = now()->subDays($days)->getTimestamp();
    $deletedCount = 0;
    $freedSpace = 0;
    
    foreach ($files as $file) {
        if (filemtime($file) < $cutoffTime) {
            $fileSize = filesize($file);
            if (unlink($file)) {
                $deletedCount++;
                $freedSpace += $fileSize;
            }
        }
    }
    
    $this->info(sprintf(
        'Deleted %d file(s), freed %s',
        $deletedCount,
        $this->humanReadableSize($freedSpace)
    ));
    
    return 0;
})->purpose('Clear log files older than specified days');

Schedule::command('logs:clear')->dailyAt('00:00');
