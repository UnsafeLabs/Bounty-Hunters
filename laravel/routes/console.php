<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Number of days to keep log files}', function () {
    $daysOption = $this->option('days');

    if (! is_numeric($daysOption) || (int) $daysOption < 1) {
        $this->error('The --days option must be a positive integer.');

        return 1;
    }

    $formatBytes = function (int $bytes): string {
        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $size = $bytes;
        $unitIndex = 0;

        while ($size >= 1024 && $unitIndex < count($units) - 1) {
            $size /= 1024;
            $unitIndex++;
        }

        if ($unitIndex === 0) {
            return $size.' '.$units[$unitIndex];
        }

        return number_format($size, 2).' '.$units[$unitIndex];
    };

    $cutoff = now()->subDays((int) $daysOption)->getTimestamp();
    $deletedFiles = 0;
    $freedBytes = 0;
    $logsPath = storage_path('logs');

    if (File::isDirectory($logsPath)) {
        foreach (File::files($logsPath) as $file) {
            if ($file->getExtension() !== 'log' || $file->getMTime() >= $cutoff) {
                continue;
            }

            $fileSize = $file->getSize();

            if (File::delete($file->getPathname())) {
                $deletedFiles++;
                $freedBytes += $fileSize;
            }
        }
    }

    $this->info(sprintf(
        'Deleted %d log file%s and freed %s.',
        $deletedFiles,
        $deletedFiles === 1 ? '' : 's',
        $formatBytes($freedBytes),
    ));

    return 0;
})->purpose('Delete old log files from storage/logs');

Schedule::command('logs:clear')->dailyAt('00:00');
