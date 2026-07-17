<?php

use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Facades\Storage;
use Illuminate\Foundation\Inspiring;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Number of days to retain}', function () {
    $days = max(1, (int) $this->option('days'));
    $cutoff = now()->subDays($days);
    $files = glob(storage_path('logs/*.log'));
    $deleted = 0;
    $freed = 0;

    foreach ($files as $file) {
        if (filemtime($file) < $cutoff->timestamp) {
            $freed += filesize($file);
            unlink($file);
            $deleted++;
        }
    }

    $freedFormatted = $freed >= 1048576
        ? round($freed / 1048576, 2) . ' MB'
        : round($freed / 1024, 2) . ' KB';

    $this->info("Deleted {$deleted} files, freed {$freedFormatted}");
})->purpose('Clear log files older than the specified days');

Schedule::command('logs:clear --days=7')->dailyAt('00:00');
