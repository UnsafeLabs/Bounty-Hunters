<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Number of days of logs to retain}', function () {
    $days = max(0, (int) $this->option('days'));
    $cutoff = now()->subDays($days)->getTimestamp();
    $logPath = storage_path('logs');
    $deletedFiles = 0;
    $freedBytes = 0;

    foreach (File::files($logPath) as $file) {
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
        format_log_cleanup_bytes($freedBytes),
    ));
})->purpose('Delete log files older than the configured retention period');

Schedule::command('logs:clear')->dailyAt('00:00');

if (! function_exists('format_log_cleanup_bytes')) {
    function format_log_cleanup_bytes(int $bytes): string
    {
        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $value = (float) $bytes;

        foreach ($units as $unit) {
            if ($value < 1024 || $unit === 'TB') {
                return sprintf(
                    '%s %s',
                    rtrim(rtrim(number_format($value, 2), '0'), '.'),
                    $unit,
                );
            }

            $value /= 1024;
        }

        return '0 B';
    }
}
