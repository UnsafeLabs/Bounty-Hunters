<?php

namespace Tests\Feature;

use Exception;
use Illuminate\Contracts\Queue\Job;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Mockery;
use Tests\TestCase;

class FailedJobMonitoringTest extends TestCase
{
    use RefreshDatabase;

    public function test_failed_job_listener_logs_job_metadata(): void
    {
        $exception = new Exception('database is unavailable');
        $job = Mockery::mock(Job::class);
        $job->shouldReceive('getQueue')->andReturn('emails');
        $job->shouldReceive('getJobId')->andReturn('job-123');
        $job->shouldReceive('resolveName')->andReturn('App\\Jobs\\SendEmail');
        $job->shouldReceive('payload')->andReturn([
            'displayName' => 'App\\Jobs\\SendEmail',
            'attempts' => 3,
        ]);

        Log::shouldReceive('error')
            ->once()
            ->with('Queue job failed', Mockery::on(function (array $context) use ($exception) {
                return $context['connection'] === 'database'
                    && $context['queue'] === 'emails'
                    && $context['job_id'] === 'job-123'
                    && $context['job'] === 'App\\Jobs\\SendEmail'
                    && $context['payload']['attempts'] === 3
                    && $context['exception_class'] === $exception::class
                    && $context['exception_message'] === 'database is unavailable'
                    && isset($context['exception_trace']);
            }));

        Event::dispatch(new JobFailed('database', $job, $exception));
    }

    public function test_failed_summary_command_groups_failed_jobs_by_exception_class(): void
    {
        $this->insertFailedJob('RuntimeException: first failure');
        $this->insertFailedJob("RuntimeException: second failure\nStack trace:");
        $this->insertFailedJob('InvalidArgumentException: bad payload');

        $this->artisan('queue:failed-summary')
            ->expectsTable(['Exception', 'Count'], [
                ['InvalidArgumentException', 1],
                ['RuntimeException', 2],
            ])
            ->assertExitCode(0);
    }

    public function test_database_queue_retry_configuration_is_set(): void
    {
        $this->assertSame(90, Config::get('queue.connections.database.retry_after'));
        $this->assertSame(3, Config::get('queue.connections.database.max_tries'));
    }

    private function insertFailedJob(string $exception): void
    {
        DB::table('failed_jobs')->insert([
            'uuid' => (string) Str::uuid(),
            'connection' => 'database',
            'queue' => 'default',
            'payload' => '{}',
            'exception' => $exception,
            'failed_at' => now(),
        ]);
    }
}
