<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Delete log files older than this many days}', function (): int {
    $daysOption = $this->option('days');
    $days = ! is_numeric($daysOption)
        ? 7
        : max(0, (int) $daysOption);
    $cutoff = now()->subDays($days)->getTimestamp();
    $deletedFiles = 0;
    $freedBytes = 0;

    $humanReadableBytes = function (int $bytes): string {
        $units = ['B', 'KB', 'MB', 'GB'];
        $size = (float) $bytes;

        foreach ($units as $unit) {
            if ($size < 1024 || $unit === 'GB') {
                return $unit === 'B'
                    ? sprintf('%d B', $size)
                    : sprintf('%.2f %s', $size, $unit);
            }

            $size /= 1024;
        }

        return sprintf('%d B', $bytes);
    };

    foreach (File::glob(storage_path('logs/*.log')) as $path) {
        if (! is_file($path) || filemtime($path) >= $cutoff) {
            continue;
        }

        $freedBytes += filesize($path) ?: 0;
        File::delete($path);
        $deletedFiles++;
    }

    $this->info(sprintf(
        'Deleted %d log %s and freed %s.',
        $deletedFiles,
        $deletedFiles === 1 ? 'file' : 'files',
        $humanReadableBytes($freedBytes),
    ));

    return 0;
})->purpose('Delete old log files from storage/logs');

Schedule::command('logs:clear')->dailyAt('00:00');
