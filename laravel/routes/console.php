<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('webhooks:process-retries', function () {
    $dispatcher = new \App\Services\WebhookDispatcher();
    $count = $dispatcher->processRetries();
    $this->info("Processed {$count} webhook retries.");
})->purpose('Process pending webhook retries');

Schedule::command('webhooks:process-retries')->everyMinute();
