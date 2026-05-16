<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->describe('Display an inspiring quote');

// Helper: convert bytes to human readable format
function humanReadableSize($bytes) {
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $i = 0;
    while ($bytes >= 1024 && $i < count($units) - 1) {
        $bytes /= 1024;
        $i++;
    }
    return round($bytes, 2) . ' ' . $units[$i];
}

Artisan::command('logs:clear {--days=7 : Number of days to keep logs}', function () {
    $days = (int) $this->option('days');
    $logPath = storage_path('logs');

    if (!is_dir($logPath)) {
        $this->error('Log directory not found: ' . $logPath);
        return 1;
    }

    $files = glob($logPath . '/*.log');
    if ($files === false) {
        $this->error('Failed to scan log directory');
        return 1;
    }

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
        humanReadableSize($freedSpace)
    ));

    return 0;
})->describe('Clear log files older than specified days');

Schedule::command('logs:clear')->dailyAt('00:00');
