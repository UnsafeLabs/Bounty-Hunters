<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Number of days of logs to keep}', function () {
    $days = max(0, (int) $this->option('days'));
    $cutoff = now()->subDays($days)->getTimestamp();
    $deletedFiles = 0;
    $freedBytes = 0;

    foreach (File::glob(storage_path('logs/*.log')) ?: [] as $path) {
        if (! File::isFile($path) || File::lastModified($path) >= $cutoff) {
            continue;
        }

        $bytes = File::size($path);

        if (File::delete($path)) {
            $deletedFiles++;
            $freedBytes += $bytes;
        }
    }

    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $size = (float) $freedBytes;
    $unitIndex = 0;

    while ($size >= 1024 && $unitIndex < count($units) - 1) {
        $size /= 1024;
        $unitIndex++;
    }

    $freedSpace = $unitIndex === 0
        ? "{$freedBytes} B"
        : number_format($size, 2) . ' ' . $units[$unitIndex];

    $this->info("Deleted {$deletedFiles} log file(s), freed {$freedSpace}.");
})->purpose('Delete log files older than the configured retention window');

Schedule::command('logs:clear')->dailyAt('00:00');
