<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class FailedJobSummary extends Command
{
    protected $signature = 'queue:failed-summary';
    protected $description = 'Output a summary of failed jobs grouped by exception type';

    public function handle(): int
    {
        $rows = DB::table('failed_jobs')
            ->selectRaw("JSON_EXCEPT(exception, '$.message') as exception_type, COUNT(*) as count")
            ->groupBy('exception_type')
            ->orderByDesc('count')
            ->get();

        if ($rows->isEmpty()) {
            $this->info('No failed jobs found.');
            return Command::SUCCESS;
        }

        $this->table(['Exception Type', 'Count'], $rows->map(fn($r) => [(string)$r->exception_type, $r->count]));
        return Command::SUCCESS;
    }
}
