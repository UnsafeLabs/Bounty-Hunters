<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear', function () {
    $days = $this->option('days') ?? 7;
    $logPath = storage_path('logs');
    $cutoff = now()->subDays((int) $days);

    $count = 0;
    $totalSize = 0;

    if (is_dir($logPath)) {
        $files = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($logPath, RecursiveDirectoryIterator::SKIP_DOTS)
        );

        foreach ($files as $file) {
            if ($file->isFile() && $file->getMTime() < $cutoff->getTimestamp()) {
                $totalSize += $file->getSize();
                unlink($file->getRealPath());
                $count++;
            }
        }
    }

    $freed = $totalSize > 0 ? round($totalSize / 1024, 2) . ' KB' : '0 B';

    $this->info("Cleared {$count} log file(s) older than {$days} days.");
    $this->info("Space freed: {$freed}");
})->purpose('Clear log files older than a given number of days')
  ->option('days', null, 'Number of days of logs to retain', 7);

Schedule::command('logs:clear')->dailyAt('00:00');
