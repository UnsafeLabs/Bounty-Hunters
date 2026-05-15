<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Number of days of logs to retain}', function () {
    $days = filter_var($this->option('days'), FILTER_VALIDATE_INT);

    if ($days === false || $days < 0) {
        $this->error('The --days option must be a non-negative integer.');

        return 1;
    }

    $logsPath = storage_path('logs');

    if (! File::isDirectory($logsPath)) {
        $this->info('Deleted 0 log files; freed 0 B.');

        return 0;
    }

    $cutoff = now()->subDays($days)->getTimestamp();
    $deletedFiles = 0;
    $freedBytes = 0;
    $formatBytes = static function (int $bytes): string {
        if ($bytes < 1024) {
            return $bytes.' B';
        }

        $units = ['KB', 'MB', 'GB', 'TB'];
        $value = $bytes / 1024;

        foreach ($units as $unit) {
            if ($value < 1024) {
                return rtrim(rtrim(number_format($value, 2), '0'), '.').' '.$unit;
            }

            $value /= 1024;
        }

        return rtrim(rtrim(number_format($value, 2), '0'), '.').' PB';
    };

    foreach (File::files($logsPath) as $file) {
        if (! str_ends_with($file->getFilename(), '.log') || $file->getMTime() >= $cutoff) {
            continue;
        }

        $freedBytes += $file->getSize();

        if (File::delete($file->getPathname())) {
            $deletedFiles++;
        }
    }

    $this->info(sprintf(
        'Deleted %d log %s; freed %s.',
        $deletedFiles,
        $deletedFiles === 1 ? 'file' : 'files',
        $formatBytes($freedBytes),
    ));

    return 0;
})->purpose('Delete log files older than the configured retention period');

Schedule::command('logs:clear')->dailyAt('00:00');
