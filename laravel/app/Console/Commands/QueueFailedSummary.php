<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class QueueFailedSummary extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'queue:failed-summary';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Display a summary of failed jobs grouped by exception type';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $failures = DB::table('failed_jobs')
            ->selectRaw("json_extract(payload, '$.data.commandName') as job_class")
            ->selectRaw('exception')
            ->selectRaw('failed_at')
            ->orderBy('failed_at', 'desc')
            ->get();

        if ($failures->isEmpty()) {
            $this->info('No failed jobs found.');

            return self::SUCCESS;
        }

        // Group by exception type
        $grouped = $failures->groupBy(function ($failure) {
            // Extract exception class from the exception string
            if (preg_match('/^([\\\\\w]+)/', $failure->exception, $matches)) {
                return $matches[1];
            }

            return 'Unknown';
        });

        $rows = [];
        foreach ($grouped as $exceptionClass => $items) {
            $rows[] = [
                'exception' => $exceptionClass,
                'count' => $items->count(),
                'latest' => $items->first()->failed_at,
                'job' => $items->first()->job_class ?? 'Unknown',
            ];
        }

        $this->table(
            ['Exception', 'Count', 'Latest', 'Job'],
            $rows
        );

        return self::SUCCESS;
    }
}
