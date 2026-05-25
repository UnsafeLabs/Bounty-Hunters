<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;
use Symfony\Component\Console\Command\Command;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Number of days of logs to retain}', function () {
    $days = (int) $this->option('days');

    if ($days < 1) {
        $this->error('The --days option must be at least 1.');

        return Command::FAILURE;
    }

    $logsPath = storage_path('logs');

    if (! File::isDirectory($logsPath)) {
        $this->info('No log directory found; deleted 0 files and freed 0 B.');

        return Command::SUCCESS;
    }

    $cutoff = now()->subDays($days)->getTimestamp();
    $deletedFiles = 0;
    $freedBytes = 0;

    foreach (File::files($logsPath) as $file) {
        if ($file->getMTime() >= $cutoff) {
            continue;
        }

        $fileSize = $file->getSize();

        if (File::delete($file->getPathname())) {
            $deletedFiles++;
            $freedBytes += $fileSize;
        }
    }

    $formatBytes = static function (int $bytes): string {
        if ($bytes === 0) {
            return '0 B';
        }

        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $value = (float) $bytes;
        $unitIndex = 0;

        while ($value >= 1024 && $unitIndex < count($units) - 1) {
            $value /= 1024;
            $unitIndex++;
        }

        if ($unitIndex === 0) {
            return sprintf('%d %s', $bytes, $units[$unitIndex]);
        }

        return rtrim(rtrim(number_format($value, 2, '.', ''), '0'), '.') . ' ' . $units[$unitIndex];
    };

    $this->info(sprintf(
        'Deleted %d log %s and freed %s.',
        $deletedFiles,
        $deletedFiles === 1 ? 'file' : 'files',
        $formatBytes($freedBytes),
    ));

    return Command::SUCCESS;
})->purpose('Delete log files older than the configured retention window');

Schedule::command('logs:clear')->dailyAt('00:00');
