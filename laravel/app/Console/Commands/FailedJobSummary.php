<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class FailedJobSummary extends Command
{
    protected $signature = 'queue:failed-summary';

    protected $description = 'Display failed jobs grouped by exception class';

    public function handle(): int
    {
        $rows = DB::table(config('queue.failed.table', 'failed_jobs'))
            ->select('exception')
            ->get();

        if ($rows->isEmpty()) {
            $this->info('No failed jobs found.');

            return self::SUCCESS;
        }

        $summary = $rows
            ->map(fn (object $row): string => $this->exceptionClass($row->exception))
            ->countBy()
            ->sortKeys()
            ->map(fn (int $count, string $exception): array => [$exception, $count])
            ->values()
            ->all();

        $this->table(['Exception', 'Count'], $summary);

        return self::SUCCESS;
    }

    private function exceptionClass(?string $exception): string
    {
        if (! $exception) {
            return 'Unknown';
        }

        preg_match('/^([A-Za-z_\\\\][A-Za-z0-9_\\\\]*)(?::|$)/', trim($exception), $matches);

        return $matches[1] ?? 'Unknown';
    }
}
