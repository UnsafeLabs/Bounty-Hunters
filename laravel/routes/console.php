<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;
use Carbon\Carbon;

if (!function_exists('formatBytes')) {
    function formatBytes($bytes, $precision = 2) {
        if ($bytes <= 0) {
            return '0 B';
        }
        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $pow = floor(log($bytes, 1024));
        $pow = min($pow, count($units) - 1);
        $bytes /= pow(1024, $pow);
        return round($bytes, $precision) . ' ' . $units[$pow];
    }
}

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7}', function () {
    $days = (int) $this->option('days');
    $logPath = storage_path('logs');
    
    if (!File::isDirectory($logPath)) {
        $this->error("Logs directory does not exist: {$logPath}");
        return;
    }

    $files = File::files($logPath);
    $deletedCount = 0;
    $freedSpace = 0;

    $cutoff = Carbon::now()->subDays($days);

    foreach ($files as $file) {
        if ($file->getExtension() === 'log') {
            $mtime = Carbon::createFromTimestamp($file->getMTime());
            if ($mtime->lessThan($cutoff)) {
                $size = $file->getSize();
                if (File::delete($file->getPathname())) {
                    $deletedCount++;
                    $freedSpace += $size;
                }
            }
        }
    }

    $freedSpaceHuman = formatBytes($freedSpace);
    $this->info("Deleted {$deletedCount} log files. Total space freed: {$freedSpaceHuman}.");
})->purpose('Clear log files older than X days');

Schedule::command('logs:clear')->dailyAt('00:00');
