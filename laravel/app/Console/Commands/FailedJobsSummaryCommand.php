<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class FailedJobsSummaryCommand extends Command
{
    protected $signature = 'queue:failed-summary';

    protected $description = 'Summarize failed jobs grouped by exception type';

    public function handle(): int
    {
        if (! Schema::hasTable('failed_jobs')) {
            $this->warn('failed_jobs table not found');
            return self::SUCCESS;
        }

        $rows = DB::table('failed_jobs')->get(['exception']);
        $counts = [];
        foreach ($rows as $row) {
            $class = $this->exceptionClass((string) $row->exception);
            $counts[$class] = ($counts[$class] ?? 0) + 1;
        }
        arsort($counts);
        $table = [];
        foreach ($counts as $class => $count) {
            $table[] = [$class, $count];
        }
        $this->table(['Exception', 'Count'], $table);

        return self::SUCCESS;
    }

    public function exceptionClass(string $blob): string
    {
        if (preg_match('/^([A-Za-z0-9_\\\\]+)/', $blob, $m)) {
            return $m[1];
        }
        return 'Unknown';
    }
}
