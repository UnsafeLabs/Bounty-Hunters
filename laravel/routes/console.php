<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Delete logs older than this many days}', function () {
    $days = (int) $this->option('days');
    $path = storage_path('logs');
    $cutoff = now()->subDays($days);

    $count = 0;
    $totalSize = 0;

    if (!is_dir($path)) {
        $this->warn("Logs directory does not exist.");
        return 1;
    }

    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($path, RecursiveDirectoryIterator::SKIP_DOTS)
    );

    foreach ($files as $file) {
        if (!$file->isFile()) {
            continue;
        }
        if ($file->getExtension() !== 'log' && $file->getExtension() !== 'json') {
            continue;
        }
        $mtime = (int) $file->getMTime();
        if ($mtime < $cutoff->timestamp) {
            $size = $file->getSize();
            unlink($file->getRealPath());
            $count++;
            $totalSize += $size;
        }
    }

    $this->info("Deleted {$count} log file(s).");

    if ($totalSize > 0) {
        $freed = match (true) {
            $totalSize >= 1048576 => round($totalSize / 1048576, 2) . ' MB',
            $totalSize >= 1024 => round($totalSize / 1024, 2) . ' KB',
            default => $totalSize . ' bytes',
        };
        $this->info("Freed {$freed} of disk space.");
    }

    return 0;
})->purpose('Clear log files older than a specified number of days');

Schedule::command('logs:clear')
    ->dailyAt('00:00')
    ->description('Clear log files older than 7 days');
