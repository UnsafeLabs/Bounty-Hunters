<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;
use Symfony\Component\Console\Command\Command;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Number of days of log files to keep}', function () {
    $days = (int) $this->option('days');

    if ($days < 0) {
        $this->error('The --days option must be zero or greater.');

        return Command::FAILURE;
    }

    $cutoff = now()->subDays($days)->getTimestamp();
    $deletedFiles = 0;
    $freedBytes = 0;

    foreach (File::glob(storage_path('logs/*.log')) ?: [] as $path) {
        if (filemtime($path) >= $cutoff) {
            continue;
        }

        $fileSize = (int) filesize($path);

        if (File::delete($path)) {
            $deletedFiles++;
            $freedBytes += $fileSize;
        }
    }

    $this->info(sprintf(
        'Deleted %d log %s, freed %s.',
        $deletedFiles,
        $deletedFiles === 1 ? 'file' : 'files',
        formatLogCleanupBytes($freedBytes),
    ));

    return Command::SUCCESS;
})->purpose('Delete old log files from storage/logs');

Schedule::command('logs:clear')->dailyAt('00:00');

if (! function_exists('formatLogCleanupBytes')) {
    function formatLogCleanupBytes(int $bytes): string
    {
        if ($bytes < 1024) {
            return "{$bytes} B";
        }

        $units = ['KB', 'MB', 'GB', 'TB'];
        $size = $bytes / 1024;

        foreach ($units as $unit) {
            if ($size < 1024) {
                return rtrim(rtrim(number_format($size, 2), '0'), '.') . " {$unit}";
            }

            $size /= 1024;
        }

        return rtrim(rtrim(number_format($size, 2), '0'), '.') . ' PB';
    }
}
