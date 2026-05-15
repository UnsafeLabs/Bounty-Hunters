<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Delete log files older than this many days}', function () {
    $days = max(0, (int) $this->option('days'));
    $cutoff = now()->subDays($days)->getTimestamp();
    $deleted = 0;
    $freedBytes = 0;

    foreach (glob(storage_path('logs/*.log')) ?: [] as $logFile) {
        if (is_file($logFile) && filemtime($logFile) < $cutoff) {
            $freedBytes += filesize($logFile) ?: 0;
            unlink($logFile);
            $deleted++;
        }
    }

    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $humanSize = (float) $freedBytes;
    $unitIndex = 0;

    while ($humanSize >= 1024 && $unitIndex < count($units) - 1) {
        $humanSize /= 1024;
        $unitIndex++;
    }

    $this->info(sprintf(
        'Deleted %d log file(s) older than %d day(s), freeing %.2f %s.',
        $deleted,
        $days,
        $humanSize,
        $units[$unitIndex]
    ));
})->purpose('Delete Laravel log files older than the configured retention period');

Schedule::command('logs:clear --days=7')->dailyAt('00:00');
