<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Number of days of logs to keep}', function () {
    $days = (int) $this->option('days');

    if ($days < 0) {
        $this->error('The --days option must be zero or greater.');

        return 1;
    }

    $logPath = storage_path('logs');

    if (! is_dir($logPath)) {
        $this->info('Log directory does not exist. Nothing to clear.');

        return 0;
    }

    $cutoff = now()->subDays($days)->getTimestamp();
    $deletedFiles = 0;
    $freedBytes = 0;

    $formatBytes = function (int $bytes): string {
        if ($bytes < 1024) {
            return $bytes . ' B';
        }

        $units = ['KB', 'MB', 'GB', 'TB', 'PB'];
        $value = $bytes / 1024;

        foreach ($units as $unit) {
            if ($value < 1024) {
                return number_format($value, 2) . ' ' . $unit;
            }

            $value /= 1024;
        }

        return number_format($value, 2) . ' PB';
    };

    foreach (glob($logPath . DIRECTORY_SEPARATOR . '*') ?: [] as $file) {
        if (! is_file($file)) {
            continue;
        }

        if (basename($file) === '.gitignore') {
            continue;
        }

        $modifiedAt = filemtime($file);

        if ($modifiedAt === false || $modifiedAt > $cutoff) {
            continue;
        }

        $fileSize = filesize($file) ?: 0;

        if (unlink($file)) {
            $deletedFiles++;
            $freedBytes += $fileSize;
        }
    }

    $this->info("Deleted {$deletedFiles} log file(s).");
    $this->info('Freed ' . $formatBytes($freedBytes) . '.');

    return 0;
})->purpose('Delete log files older than the configured number of days');

Schedule::command('logs:clear')->dailyAt('00:00');