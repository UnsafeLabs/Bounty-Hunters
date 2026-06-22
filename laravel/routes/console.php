<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');


use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;

Artisan::command('logs:clear {--days= : Number of days to keep}', function () {
    $days = (int) ($this->option('days') ?: 7);
    $logPath = storage_path('logs');
    $files = File::files($logPath);
    $cutoff = now()->subDays($days);
    $deleted = 0;
    $freedBytes = 0;

    foreach ($files as $file) {
        if ($file->getExtension() === 'log' && $file->getMTime() < $cutoff->timestamp) {
            $freedBytes += $file->getSize();
            File::delete($file->getPathname());
            $deleted++;
        }
    }

    $freedFormatted = $freedBytes >= 1048576
        ? round($freedBytes / 1048576, 2) . ' MB'
        : ($freedBytes >= 1024 ? round($freedBytes / 1024, 2) . ' KB' : $freedBytes . ' B');

    $this->info("Deleted {$deleted} log files, freed {$freedFormatted}");
})->purpose('Clear log files older than the specified number of days');

Schedule::command('logs:clear')->dailyAt('00:00');
