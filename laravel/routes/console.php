<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Facades\File;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Log cleanup command: removes log files older than specified days (default: 7)
Artisan::command('logs:clear', function () {
    $days = $this->argument('days') ?? 7;
    $logDir = storage_path('logs');
    $cutoff = now()->subDays($days);

    if (! File::exists($logDir)) {
        $this->info("Log directory does not exist: {$logDir}");
        return;
    }

    $files = File::files($logDir);
    $deleted = 0;
    $freed = 0;

    foreach ($files as $file) {
        if ($file->getLastModified() < $cutoff->timestamp) {
            $freed += $file->getSize();
            File::delete($file->getPathname());
            $deleted++;
        }
    }

    $this->info("✓ Cleaned up {$deleted} log file(s) older than {$days} days.");
    $this->info("✓ Freed " . $this->humanFileSize($freed));
})->purpose('Clear log files older than specified days')
  ->argument('days', 'Number of days to retain logs (default: 7)', optional: true);

// Schedule: run log cleanup daily at midnight
Schedule::command('logs:clear')->daily();
