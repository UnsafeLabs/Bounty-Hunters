<?php

namespace Tests\Feature;

use App\Listeners\LogFailedJob;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Queue\Jobs\Job;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Mockery;
use RuntimeException;
use Tests\TestCase;

class FailedJobMonitoringTest extends TestCase
{
    use RefreshDatabase;

    public function test_failed_job_listener_logs_job_metadata(): void
    {
        Log::spy();

        $job = Mockery::mock(Job::class);
        $job->shouldReceive('payload')->once()->andReturn([
            'displayName' => 'App\\Jobs\\ImportCustomers',
            'uuid' => 'job-uuid',
        ]);
        $job->shouldReceive('getQueue')->once()->andReturn('imports');

        $exception = new RuntimeException('Import failed');
        $event = new JobFailed('database', $job, $exception);

        $this->assertNotEmpty(app('events')->getListeners(JobFailed::class));

        (new LogFailedJob)->handle($event);

        Log::shouldHaveReceived('error')->once()->with('Queue job failed', Mockery::on(function (array $context) use ($exception) {
            return $context['connection'] === 'database'
                && $context['queue'] === 'imports'
                && $context['job'] === 'App\\Jobs\\ImportCustomers'
                && $context['payload']['uuid'] === 'job-uuid'
                && $context['exception_class'] === RuntimeException::class
                && $context['exception_message'] === 'Import failed'
                && $context['exception_trace'] === $exception->getTraceAsString();
        }));
    }

    public function test_failed_summary_command_groups_failed_jobs_by_exception_class(): void
    {
        Config::set('queue.failed.table', 'failed_jobs');

        DB::table('failed_jobs')->insert([
            [
                'uuid' => 'failed-1',
                'connection' => 'database',
                'queue' => 'default',
                'payload' => '{}',
                'exception' => 'RuntimeException: First failure',
            ],
            [
                'uuid' => 'failed-2',
                'connection' => 'database',
                'queue' => 'default',
                'payload' => '{}',
                'exception' => 'RuntimeException: Second failure',
            ],
            [
                'uuid' => 'failed-3',
                'connection' => 'database',
                'queue' => 'default',
                'payload' => '{}',
                'exception' => 'InvalidArgumentException: Bad input',
            ],
        ]);

        $this->artisan('queue:failed-summary')
            ->expectsTable(['Exception', 'Count'], [
                ['InvalidArgumentException', 1],
                ['RuntimeException', 2],
            ])
            ->assertSuccessful();
    }

    public function test_database_queue_config_sets_retry_after_and_max_tries(): void
    {
        $this->assertSame(90, config('queue.connections.database.retry_after'));
        $this->assertSame(3, config('queue.connections.database.max_tries'));
    }
}
