<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear', function () {
    $days = $this->option('days') ?? 7;
    $path = storage_path('logs');
    $cutoff = now()->subDays((int) $days);
    $files = File::files($path);
    $count = 0;
    $freed = 0;

    foreach ($files as $file) {
        if ($file->getExtension() !== 'log') continue;
        if ($file->getMTime() < $cutoff->timestamp) {
            $size = $file->getSize();
            File::delete($file->getPathname());
            $count++;
            $freed += $size;
        }
    }

    $this->info("Deleted {$count} log files, freed " . number_format($freed / 1024, 2) . " KB");
})->purpose('Clear old log files');

Schedule::command('logs:clear', ['--days' => 7])->dailyAt('00:00');
