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
    protected $description = 'Outputs a table of failed jobs grouped by exception type with counts';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $failedJobs = DB::table('failed_jobs')->get();

        if ($failedJobs->isEmpty()) {
            $this->info('No failed jobs found.');
            return 0;
        }

        $summary = [];

        foreach ($failedJobs as $job) {
            $class = $this->getExceptionClass($job->exception);
            if (!isset($summary[$class])) {
                $summary[$class] = 0;
            }
            $summary[$class]++;
        }

        // Sort by count descending
        arsort($summary);

        $headers = ['Exception Class', 'Count'];
        $rows = [];
        foreach ($summary as $class => $count) {
            $rows[] = [$class, $count];
        }

        $this->table($headers, $rows);

        return 0;
    }

    /**
     * Get the exception class name from the full exception string.
     */
    private function getExceptionClass(string $exceptionString): string
    {
        $firstLine = explode("\n", $exceptionString)[0] ?? '';
        $parts = explode(':', $firstLine, 2);
        $class = trim($parts[0]);
        return $class ?: 'UnknownException';
    }
}
