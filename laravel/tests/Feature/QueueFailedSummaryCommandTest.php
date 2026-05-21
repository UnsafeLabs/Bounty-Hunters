<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Group;
use Tests\TestCase;

#[Group('feature')]
class QueueFailedSummaryCommandTest extends TestCase
{
    use RefreshDatabase;

    public function test_failed_summary_groups_failed_jobs_by_exception_class(): void
    {
        $this->insertFailedJob('RuntimeException: First failure');
        $this->insertFailedJob('RuntimeException: Second failure');
        $this->insertFailedJob('InvalidArgumentException: Bad argument');

        $this->artisan('queue:failed-summary')
            ->expectsTable(
                ['Exception', 'Count'],
                [
                    ['RuntimeException', 2],
                    ['InvalidArgumentException', 1],
                ],
            )
            ->assertExitCode(0);
    }

    public function test_failed_summary_handles_empty_failed_jobs_table(): void
    {
        $this->artisan('queue:failed-summary')
            ->expectsOutput('No failed jobs found.')
            ->assertExitCode(0);
    }

    private function insertFailedJob(string $exception): void
    {
        DB::table('failed_jobs')->insert([
            'uuid' => fake()->uuid(),
            'connection' => 'database',
            'queue' => 'default',
            'payload' => json_encode(['displayName' => 'Tests\\Fixtures\\ExampleJob']),
            'exception' => $exception,
            'failed_at' => now(),
        ]);
    }
}
