<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('queue:failed-summary', function () {
    $failedJobs = DB::table(config('queue.failed.table', 'failed_jobs'))
        ->select('exception')
        ->get();

    if ($failedJobs->isEmpty()) {
        $this->info('No failed jobs found.');

        return 0;
    }

    $summary = $failedJobs
        ->map(fn (object $job): string => strtok($job->exception, ':') ?: 'Unknown exception')
        ->countBy()
        ->sortKeys()
        ->map(fn (int $count, string $exception): array => [$exception, $count])
        ->values()
        ->all();

    $this->table(['Exception', 'Count'], $summary);

    return 0;
})->purpose('Show failed queue jobs grouped by exception class');
