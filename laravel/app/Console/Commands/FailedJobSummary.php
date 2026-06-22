<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class FailedJobSummary extends Command
{
    protected $signature = "queue:failed-summary";
    protected $description = "Display failed jobs grouped by exception type";

    public function handle(): int
    {
        if (!\Schema::hasTable("failed_jobs")) {
            $this->warn("No failed_jobs table found.");
            return 0;
        }

        $failed = DB::table("failed_jobs")
            ->select(DB::raw("payload, exception, failed_at"))
            ->get();

        if ($failed->isEmpty()) {
            $this->info("No failed jobs found.");
            return 0;
        }

        $grouped = [];
        foreach ($failed as $job) {
            $exception = json_decode($job->exception, true);
            $class = $exception["class"] ?? "Unknown";
            if (!isset($grouped[$class])) {
                $grouped[$class] = 0;
            }
            $grouped[$class]++;
        }

        $rows = [];
        foreach ($grouped as $class => $count) {
            $rows[] = [$class, $count];
        }

        $this->table(["Exception Type", "Count"], $rows);
        $this->info("Total failed jobs: ".$failed->count());

        return 0;
    }
}
