<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

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
    $days = max(0, (int) $this->option('days'));
    $cutoff = now()->subDays($days)->getTimestamp();
    $deleted = 0;
    $freedBytes = 0;

    $logPath = storage_path('logs');
    if (!is_dir($logPath)) {
        $this->error('Log directory not found: ' . $logPath);
        return 1;
    }

    foreach (glob($logPath . '/*.log') ?: [] as $logFile) {
        if (is_file($logFile) && filemtime($logFile) < $cutoff) {
            $freedBytes += filesize($logFile) ?: 0;
            unlink($logFile);
            $deleted++;
        }
    }

    $this->info(sprintf(
        'Deleted %d log file(s), freed %s.',
        $deleted,
        humanReadableSize($freedBytes)
    ));

    return 0;
})->purpose('Delete Laravel log files older than the configured retention period');

Schedule::command('logs:clear --days=7')->dailyAt('00:00');
