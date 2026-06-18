<?php

namespace Tests\Feature;

use App\Listeners\LogFailedJob;
use Illuminate\Contracts\Queue\Job;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Mockery;
use RuntimeException;
use Symfony\Component\Console\Command\Command;
use Tests\TestCase;

class FailedJobMonitoringTest extends TestCase
{
    use RefreshDatabase;

    public function test_failed_job_listener_is_registered(): void
    {
        Event::fake();

        Event::assertListening(JobFailed::class, LogFailedJob::class);
    }

    public function test_failed_job_listener_logs_queue_payload_and_exception_metadata(): void
    {
        $job = Mockery::mock(Job::class);
        $job->shouldReceive('getQueue')->once()->andReturn('emails');
        $job->shouldReceive('resolveName')->once()->andReturn('App\\Jobs\\SendEmail');
        $job->shouldReceive('payload')->once()->andReturn([
            'uuid' => 'job-uuid',
            'displayName' => 'App\\Jobs\\SendEmail',
        ]);

        $exception = new RuntimeException('SMTP gateway failed');

        Log::shouldReceive('error')
            ->once()
            ->with('Queue job failed', Mockery::on(function (array $context) use ($exception): bool {
                return $context['connection'] === 'database'
                    && $context['queue'] === 'emails'
                    && $context['job'] === 'App\\Jobs\\SendEmail'
                    && $context['payload']['uuid'] === 'job-uuid'
                    && $context['exception']['class'] === RuntimeException::class
                    && $context['exception']['message'] === 'SMTP gateway failed'
                    && $context['exception']['file'] === $exception->getFile()
                    && $context['exception']['line'] === $exception->getLine()
                    && is_string($context['exception']['trace']);
            }));

        (new LogFailedJob)->handle(new JobFailed('database', $job, $exception));
    }

    public function test_failed_summary_command_groups_failed_jobs_by_exception_class(): void
    {
        $this->insertFailedJob(RuntimeException::class.': first failure');
        $this->insertFailedJob(RuntimeException::class.': second failure');
        $this->insertFailedJob(InvalidArgumentException::class.': bad argument');

        $this->artisan('queue:failed-summary')
            ->expectsTable(
                ['Exception', 'Count'],
                [
                    [InvalidArgumentException::class, 1],
                    [RuntimeException::class, 2],
                ],
            )
            ->assertExitCode(Command::SUCCESS);
    }

    public function test_database_queue_retry_settings_are_configured(): void
    {
        $this->assertSame(90, config('queue.connections.database.retry_after'));
        $this->assertSame(3, config('queue.connections.database.max_tries'));
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
