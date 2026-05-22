<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : The number of days to retain logs}', function () {
    $days = (int) $this->option('days');
    $path = storage_path('logs');
    $files = glob($path . '/*.log');
    
    $now = time();
    $deletedCount = 0;
    $freedSpace = 0;
    
    foreach ($files as $file) {
        if (is_file($file) && ($now - filemtime($file)) >= $days * 86400) {
            $freedSpace += filesize($file);
            unlink($file);
            $deletedCount++;
        }
    }
    
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $bytes = max($freedSpace, 0);
    $pow = floor(($bytes ? log($bytes) : 0) / log(1024));
    $pow = min($pow, count($units) - 1);
    $bytes /= pow(1024, $pow);
    $freedSpaceStr = round($bytes, 2) . ' ' . $units[$pow];
    
    $this->info("Deleted {$deletedCount} log file(s). Freed space: {$freedSpaceStr}.");
})->purpose('Clear log files older than a specified number of days');

\Illuminate\Support\Facades\Schedule::command('logs:clear')->dailyAt('00:00');
