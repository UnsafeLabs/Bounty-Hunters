<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;

$formatBytes = static function (int $bytes): string {
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $value = (float) $bytes;

    foreach ($units as $unit) {
        if ($value < 1024 || $unit === 'TB') {
            return rtrim(rtrim(number_format($value, 2), '0'), '.') . ' ' . $unit;
        }

        $value /= 1024;
    }
};

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Number of days of log files to retain}', function () use ($formatBytes) {
    $daysOption = $this->option('days');

    if (! is_numeric($daysOption) || (int) $daysOption < 0) {
        $this->error('The --days option must be a non-negative integer.');

        return 1;
    }

    $retentionDays = (int) $daysOption;
    $cutoffTimestamp = now()->subDays($retentionDays)->getTimestamp();
    $logDirectory = storage_path('logs');
    $deletedFiles = 0;
    $freedBytes = 0;

    if (! File::isDirectory($logDirectory)) {
        $this->info('Deleted 0 log files and freed 0 B.');

        return 0;
    }

    foreach (File::files($logDirectory) as $file) {
        if ($file->getExtension() !== 'log' || $file->getMTime() > $cutoffTimestamp) {
            continue;
        }

        $fileSize = $file->getSize();

        if (File::delete($file->getPathname())) {
            $deletedFiles++;
            $freedBytes += $fileSize;
        }
    }

    $this->info(sprintf(
        'Deleted %d log %s and freed %s.',
        $deletedFiles,
        $deletedFiles === 1 ? 'file' : 'files',
        $formatBytes($freedBytes),
    ));

    return 0;
})->purpose('Delete Laravel log files older than the configured retention window');

Schedule::command('logs:clear')->dailyAt('00:00');
