<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('queue:failed-summary', function () {
    $failedTable = config('queue.failed.table', 'failed_jobs');
    $failedJobs = DB::table($failedTable)->select('exception')->get();
    $resolveExceptionClass = static function (string $exception): string {
        $firstLine = trim(strtok($exception, "\n") ?: $exception);

        if (preg_match('/^([A-Za-z_\\\\][A-Za-z0-9_\\\\]*)(?::|\\s)/', $firstLine, $matches) === 1) {
            return $matches[1];
        }

        return $firstLine !== '' ? $firstLine : 'Unknown';
    };

    if ($failedJobs->isEmpty()) {
        $this->info('No failed jobs found.');

        return 0;
    }

    $summary = $failedJobs
        ->map(fn ($job) => [
            'exception' => $resolveExceptionClass((string) $job->exception),
        ])
        ->countBy('exception')
        ->sortKeys()
        ->map(fn (int $count, string $exception) => [$exception, $count])
        ->values()
        ->all();

    $this->table(['Exception', 'Count'], $summary);

    return 0;
})->purpose('Display failed queue jobs grouped by exception class');
