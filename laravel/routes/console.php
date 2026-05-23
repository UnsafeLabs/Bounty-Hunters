<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear {--days=7 : Number of days to retain logs}', function () {
    $days = (int) $this->option('days');
    $logDir = storage_path('logs');
    $cutoff = now()->subDays($days);
    $deleted = 0;
    $freed = 0;

    foreach (glob($logDir . '/*.log') as $file) {
        if (filemtime($file) < $cutoff->timestamp) {
            $freed += filesize($file);
            unlink($file);
            $deleted++;
        }
    }

    $freedHuman = $freed >= 1048576
        ? round($freed / 1048576, 2) . ' MB'
        : round($freed / 1024, 2) . ' KB';

    $this->info("Deleted {$deleted} log file(s), freed {$freedHuman}");
})->purpose('Delete log files older than the specified number of days');

Schedule::command('logs:clear')
    ->dailyAt('00:00')
    ->appendOutputTo(storage_path('logs/schedule.log'));
