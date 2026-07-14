<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('queue:failed-summary', function () {
    $failed = DB::table('failed_jobs')
        ->selectRaw("json_extract(payload, '$.data.commandName') as command_name, count(*) as count")
        ->groupBy('command_name')
        ->orderByDesc('count')
        ->get();

    if ($failed->isEmpty()) {
        $this->info('No failed jobs.');
        return 0;
    }

    $this->table(
        ['Exception / Command', 'Count'],
        $failed->map(fn ($row) => [
            $row->command_name ?? 'Unknown',
            $row->count,
        ])->toArray()
    );

    return 0;
})->purpose('Display a summary of failed jobs grouped by exception/command type');
