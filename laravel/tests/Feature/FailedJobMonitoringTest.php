<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Contracts\Queue\Job;
use Tests\TestCase;

class FailedJobMonitoringTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Test that the JobFailed event listener logs job details.
     */
    public function test_listener_logs_failed_job_details(): void
    {
        $exception = new \RuntimeException('Something went wrong');
        $job = $this->createMock(Job::class);
        $job->method('getQueue')->willReturn('test-queue');
        $job->method('getRawBody')->willReturn('{"job":"TestJob"}');

        $logs = [];
        Log::listen(function (\Illuminate\Log\Events\MessageLogged $logged) use (&$logs) {
            $logs[] = [
                'level' => $logged->level,
                'message' => $logged->message,
                'context' => $logged->context,
            ];
        });

        $event = new JobFailed('test-connection', $job, $exception);
        
        event($event);

        $this->assertGreaterThanOrEqual(1, count($logs));
        $this->assertEquals('error', $logs[0]['level']);
        $this->assertEquals('Queue job failed: Something went wrong', $logs[0]['message']);
        $this->assertEquals('test-connection', $logs[0]['context']['connection']);
        $this->assertEquals('test-queue', $logs[0]['context']['queue']);
        $this->assertEquals('{"job":"TestJob"}', $logs[0]['context']['payload']);
        $this->assertSame($exception, $logs[0]['context']['exception']);
    }

    /**
     * Test that the queue:failed-summary command outputs correct table when failed jobs exist.
     */
    public function test_command_outputs_failed_jobs_summary(): void
    {
        DB::table('failed_jobs')->insert([
            [
                'uuid' => 'uuid-1',
                'connection' => 'database',
                'queue' => 'default',
                'payload' => 'payload-1',
                'exception' => "InvalidArgumentException: First exception in /path/to/file.php:12\nStack trace...",
                'failed_at' => now(),
            ],
            [
                'uuid' => 'uuid-2',
                'connection' => 'database',
                'queue' => 'default',
                'payload' => 'payload-2',
                'exception' => "InvalidArgumentException: Second exception in /path/to/file.php:14\nStack trace...",
                'failed_at' => now(),
            ],
            [
                'uuid' => 'uuid-3',
                'connection' => 'database',
                'queue' => 'default',
                'payload' => 'payload-3',
                'exception' => "RuntimeException: Another exception in /path/to/file.php:20\nStack trace...",
                'failed_at' => now(),
            ],
        ]);

        $this->artisan('queue:failed-summary')
            ->expectsTable(
                ['Exception Class', 'Count'],
                [
                    ['InvalidArgumentException', 2],
                    ['RuntimeException', 1],
                ]
            )
            ->assertExitCode(0);
    }

    /**
     * Test that the queue:failed-summary command outputs a friendly message when empty.
     */
    public function test_command_outputs_no_failed_jobs_found_when_empty(): void
    {
        $this->artisan('queue:failed-summary')
            ->expectsOutput('No failed jobs found.')
            ->assertExitCode(0);
    }
}
