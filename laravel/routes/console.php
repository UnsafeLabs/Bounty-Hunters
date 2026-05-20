<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;
use Symfony\Component\Console\Command\Command;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Delete log files older than this many days}', function (): int {
    $days = (int) $this->option('days');

    if ($days < 0) {
        $this->error('The --days option must be zero or greater.');

        return Command::FAILURE;
    }

    $logsPath = storage_path('logs');
    File::ensureDirectoryExists($logsPath);

    $cutoff = now()->subDays($days)->getTimestamp();
    $deletedFiles = 0;
    $freedBytes = 0;

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

    $formatBytes = static function (int $bytes): string {
        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $size = (float) $bytes;

        foreach ($units as $unit) {
            if ($size < 1024 || $unit === 'TB') {
                return $unit === 'B'
                    ? sprintf('%d %s', $bytes, $unit)
                    : sprintf('%.2f %s', $size, $unit);
            }

            $size /= 1024;
        }

        return sprintf('%d B', $bytes);
    };

    $this->info(sprintf(
        'Deleted %d log %s and freed %s.',
        $deletedFiles,
        $deletedFiles === 1 ? 'file' : 'files',
        $formatBytes($freedBytes),
    ));

    return Command::SUCCESS;
})->purpose('Delete old log files from storage/logs');

Schedule::command('logs:clear')->dailyAt('00:00');
