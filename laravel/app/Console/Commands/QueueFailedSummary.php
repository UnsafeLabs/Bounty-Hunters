<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

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
    public function handle()
    {
        if (!Schema::hasTable('failed_jobs')) {
            $this->error('The failed_jobs table does not exist.');
            return 1;
        }

        $summary = DB::table('failed_jobs')
            ->select('exception', DB::raw('COUNT(*) as count'))
            ->groupBy('exception')
            ->orderByDesc('count')
            ->get();

        if ($summary->isEmpty()) {
            $this->info('No failed jobs found.');
            return 0;
        }

        $this->table(
            ['Exception Class', 'Count'],
            $summary->map(fn ($row) => [class_basename($row->exception), $row->count])->toArray()
        );

        return 0;
    }
}