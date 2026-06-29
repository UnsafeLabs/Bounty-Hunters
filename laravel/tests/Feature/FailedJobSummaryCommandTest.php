<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class FailedJobSummaryCommandTest extends TestCase
{
    use RefreshDatabase;

    public function test_failed_summary_groups_failed_jobs_by_exception_class(): void
    {
        DB::table('failed_jobs')->insert([
            [
                'uuid' => 'failed-job-1',
                'connection' => 'database',
                'queue' => 'default',
                'payload' => '{}',
                'exception' => "RuntimeException: First failure\nStack trace:",
            ],
            [
                'uuid' => 'failed-job-2',
                'connection' => 'database',
                'queue' => 'default',
                'payload' => '{}',
                'exception' => "RuntimeException: Second failure\nStack trace:",
            ],
            [
                'uuid' => 'failed-job-3',
                'connection' => 'database',
                'queue' => 'emails',
                'payload' => '{}',
                'exception' => "InvalidArgumentException: Bad argument\nStack trace:",
            ],
        ]);

        $this->artisan('queue:failed-summary')
            ->expectsTable(
                ['Exception', 'Failed Jobs'],
                [
                    ['InvalidArgumentException', 1],
                    ['RuntimeException', 2],
                ],
            )
            ->assertSuccessful();
    }
}
