<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('cache:prune-stale-tags', function () {
    $this->comment('Pruning cache tags...');
})->everyMinute()->withoutOverlapping();

Artisan::command('queue:restart', function () {
    $this->comment('Restarting queue workers...');
})->hourly();

Artisan::command('logs:rotate', function () {
    $this->comment('Rotating log files...');
})->daily();
