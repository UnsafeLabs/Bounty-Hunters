<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('logs:clear', function () {
    $logPath = storage_path('logs');
    $files = glob($logPath . '/*.log');
    foreach ($files as $file) {
        unlink($file);
    }
    $this->info('Log files cleared!');
})->purpose('Clear application log files');

Schedule::command('logs:clear')->daily();
