<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote')->daily();

// Register scheduled tasks
Artisan::command('schedule:work', function () {
    $this->info('Running scheduled tasks...');
})->purpose('Run the schedule worker (alias for schedule:run)');
