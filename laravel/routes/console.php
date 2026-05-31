<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Delete log files older than this many days}', function () {
    $days = (int) $this->option('days');

    if ($days < 0) {
        $this->error('The --days option must be zero or greater.');

        return 1;
    }

    $formatBytes = static function (int $bytes): string {
        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $size = (float) $bytes;
        $unitIndex = 0;

        while ($size >= 1024 && $unitIndex < count($units) - 1) {
            $size /= 1024;
            $unitIndex++;
        }

        if ($unitIndex === 0) {
            return $bytes.' '.$units[$unitIndex];
        }

        return rtrim(rtrim(number_format($size, 1), '0'), '.').' '.$units[$unitIndex];
    };

    $logPath = storage_path('logs');
    $cutoffTimestamp = now()->subDays($days)->getTimestamp();
    $deletedCount = 0;
    $freedBytes = 0;

    if (File::isDirectory($logPath)) {
        foreach (File::files($logPath) as $file) {
            if ($file->getExtension() !== 'log' || $file->getMTime() >= $cutoffTimestamp) {
                continue;
            }

            $size = $file->getSize();

            if (File::delete($file->getPathname())) {
                $deletedCount++;
                $freedBytes += $size;
            }
        }
    }

    $this->info(sprintf(
        'Deleted %d log %s; freed %s.',
        $deletedCount,
        $deletedCount === 1 ? 'file' : 'files',
        $formatBytes($freedBytes),
    ));

    return 0;
})->purpose('Delete old Laravel log files');

Schedule::command('logs:clear')->dailyAt('00:00');
