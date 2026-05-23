<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class FailedJobSummary extends Command
{
    protected $signature = 'queue:failed-summary';

    protected $description = 'Show failed jobs grouped by exception class';

    public function handle(): int
    {
        $table = config('queue.failed.table', 'failed_jobs');
        $rows = DB::table($table)->select('exception')->get();

        if ($rows->isEmpty()) {
            $this->info('No failed jobs found.');

            return self::SUCCESS;
        }

        $summary = $rows
            ->map(fn ($row) => $this->exceptionClass((string) $row->exception))
            ->countBy()
            ->sortDesc()
            ->map(fn ($count, $exception) => [
                'Exception' => $exception,
                'Count' => $count,
            ])
            ->values()
            ->all();

        $this->table(['Exception', 'Count'], $summary);

        return self::SUCCESS;
    }

    private function exceptionClass(string $exception): string
    {
        if (preg_match('/^([A-Za-z0-9_\\\\]+)(:|\\s)/', $exception, $matches)) {
            return $matches[1];
        }

        return 'Unknown';
    }
}
