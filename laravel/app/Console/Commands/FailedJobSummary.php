<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class FailedJobSummary extends Command
{
    protected $signature = 'queue:failed-summary';
    protected $description = 'Output a summary of failed jobs grouped by exception type';

    public function handle(): void
    {
        $rows = DB::table('failed_jobs')
            ->selectRaw("SUBSTRING_INDEX(exception, '\\n', 1) as exception_type, COUNT(*) as total")
            ->groupBy('exception_type')
            ->orderByDesc('total')
            ->get();

        if ($rows->isEmpty()) {
            $this->info('No failed jobs found.');
            return;
        }

        $this->table(['Exception', 'Count'], $rows->toArray());
    }
}
