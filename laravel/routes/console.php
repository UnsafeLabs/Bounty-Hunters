<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;

Artisan::command('logs:clear {--days=7 : Delete log files older than this many days}', function () {
    $days = (int) $this->option('days');
    $cutoff = now()->subDays($days)->getTimestamp();
    $logPath = storage_path('logs');

    if (! File::isDirectory($logPath)) {
        $this->info('No log directory found.');

        return;
    }

    $deletedCount = 0;
    $freedBytes = 0;

    foreach (File::files($logPath) as $file) {
        if ($file->getMTime() < $cutoff) {
            $freedBytes += $file->getSize();
            File::delete($file->getPathname());
            $deletedCount++;
        }
    }

    $this->info(sprintf(
        'Deleted %d log file(s), freed %s.',
        $deletedCount,
        format_bytes($freedBytes),
    ));
})->purpose('Delete log files older than the configured retention period');

if (! function_exists('format_bytes')) {
    function format_bytes(int $bytes): string
    {
        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $size = (float) $bytes;
        $unit = 0;

        while ($size >= 1024 && $unit < count($units) - 1) {
            $size /= 1024;
            $unit++;
        }

        return number_format($size, 2).' '.$units[$unit];
    }
}

Schedule::command('logs:clear')->dailyAt('00:00');

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');
