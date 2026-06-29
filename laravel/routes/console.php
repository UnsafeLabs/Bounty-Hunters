<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('queue:failed-summary', function () {
    $exceptionClassFrom = static function (string $exception): string {
        $firstLine = strtok($exception, "\n") ?: '';

        if (
            preg_match(
                '/^([A-Za-z_\\\\][A-Za-z0-9_\\\\]*)(?::|$)/',
                $firstLine,
                $matches,
            ) === 1
        ) {
            return $matches[1];
        }

        return 'UnknownException';
    };

    $failedJobsTable = config('queue.failed.table', 'failed_jobs');
    $failedJobs = DB::table($failedJobsTable)
        ->select('exception')
        ->get()
        ->groupBy(fn (object $job): string => $exceptionClassFrom($job->exception))
        ->map(fn ($jobs, string $exception): array => [$exception, $jobs->count()])
        ->sortBy(fn (array $row): string => $row[0])
        ->values()
        ->all();

    if ($failedJobs === []) {
        $this->info('No failed jobs found.');

        return 0;
    }

    $this->table(['Exception', 'Failed Jobs'], $failedJobs);

    return 0;
})->purpose('Display failed jobs grouped by exception type');
