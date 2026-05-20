<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

class FailedJobSummary extends Command
{
    protected $signature = 'queue:failed-summary';

    protected $description = 'Display failed jobs grouped by exception type';

    public function handle(): int
    {
        $rows = DB::table(config('queue.failed.table', 'failed_jobs'))
            ->select('exception')
            ->get()
            ->groupBy(fn (object $job): string => $this->exceptionClass($job->exception ?? ''))
            ->map(fn ($jobs, string $exception): array => [
                'Exception' => $exception,
                'Count' => $jobs->count(),
            ])
            ->sortByDesc('Count')
            ->values()
            ->all();

        if ($rows === []) {
            $this->info('No failed jobs found.');

            return self::SUCCESS;
        }

        $this->table(['Exception', 'Count'], $rows);

        return self::SUCCESS;
    }

    private function exceptionClass(string $exception): string
    {
        if ($exception === '') {
            return 'Unknown';
        }

        $unserialized = @unserialize($exception);

        if ($unserialized instanceof Throwable) {
            return $unserialized::class;
        }

        if (preg_match('/^([A-Za-z_\\\\][A-Za-z0-9_\\\\]*)[:\\s]/', $exception, $matches) === 1) {
            return $matches[1];
        }

        return 'Unknown';
    }
}
