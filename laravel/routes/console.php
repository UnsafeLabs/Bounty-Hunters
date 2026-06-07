<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Delete log files older than this many days}', function () {
    $days = max(0, (int) $this->option('days'));
    $cutoff = now()->subDays($days)->getTimestamp();
    $logsPath = storage_path('logs');
    $deletedFiles = 0;
    $freedBytes = 0;
    $formatBytes = function (int $bytes): string {
        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $value = (float) $bytes;
        $unitIndex = 0;

        while ($value >= 1024 && $unitIndex < count($units) - 1) {
            $value /= 1024;
            $unitIndex++;
        }

        return sprintf(
            '%s %s',
            rtrim(rtrim(number_format($value, 2), '0'), '.'),
            $units[$unitIndex],
        );
    };

    File::ensureDirectoryExists($logsPath);

    foreach (File::files($logsPath) as $file) {
        if ($file->getMTime() >= $cutoff) {
            continue;
        }

        $freedBytes += $file->getSize();
        File::delete($file->getPathname());
        $deletedFiles++;
    }

    $this->info(sprintf(
        'Deleted %d log file%s and freed %s.',
        $deletedFiles,
        $deletedFiles === 1 ? '' : 's',
        $formatBytes($freedBytes),
    ));
})->purpose('Delete old log files from storage/logs');

Schedule::command('logs:clear')->dailyAt('00:00');
