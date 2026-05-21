<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class QueueFailedSummary extends Command
{
    protected $signature = 'queue:failed-summary';

    protected $description = 'Show failed queue jobs grouped by exception class';

    public function handle(): int
    {
        $connection = config('queue.failed.database');
        $table = config('queue.failed.table', 'failed_jobs');

        $summary = DB::connection($connection)
            ->table($table)
            ->pluck('exception')
            ->map(fn (string $exception) => $this->exceptionClass($exception))
            ->countBy()
            ->sortDesc();

        if ($summary->isEmpty()) {
            $this->info('No failed jobs found.');

            return self::SUCCESS;
        }

        $this->table(
            ['Exception', 'Count'],
            $summary->map(fn (int $count, string $exception) => [
                'Exception' => $exception,
                'Count' => $count,
            ])->values()->all(),
        );

        return self::SUCCESS;
    }

    private function exceptionClass(string $exception): string
    {
        $firstLine = trim(strtok($exception, "\n") ?: $exception);

        if (preg_match('/^([A-Za-z_\\\\][A-Za-z0-9_\\\\]*)(?::|$)/', $firstLine, $matches)) {
            return $matches[1];
        }

        return $firstLine === '' ? 'Unknown' : $firstLine;
    }
}
