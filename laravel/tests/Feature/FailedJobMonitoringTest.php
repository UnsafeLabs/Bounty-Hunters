<?php

namespace Tests\Feature;

use App\Listeners\LogFailedJob;
use Illuminate\Contracts\Queue\Job;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Mockery;
use RuntimeException;
use Tests\TestCase;

class FailedJobMonitoringTest extends TestCase
{
    public function test_failed_job_listener_logs_job_metadata(): void
    {
        Log::shouldReceive('error')
            ->once()
            ->with('Queue job failed', Mockery::on(function (array $context): bool {
                return $context['connection'] === 'database'
                    && $context['queue'] === 'emails'
                    && $context['job_id'] === 'job-123'
                    && $context['job_name'] === 'App\\Jobs\\SendEmail'
                    && $context['payload'] === ['displayName' => 'App\\Jobs\\SendEmail']
                    && $context['exception']['class'] === RuntimeException::class
                    && $context['exception']['message'] === 'SMTP rejected message';
            }));

        $job = Mockery::mock(Job::class);
        $job->shouldReceive('getQueue')->andReturn('emails');
        $job->shouldReceive('getJobId')->andReturn('job-123');
        $job->shouldReceive('resolveName')->andReturn('App\\Jobs\\SendEmail');
        $job->shouldReceive('payload')->andReturn(['displayName' => 'App\\Jobs\\SendEmail']);

        (new LogFailedJob)->handle(new JobFailed(
            'database',
            $job,
            new RuntimeException('SMTP rejected message'),
        ));
    }

    public function test_database_queue_failed_job_limits_are_configured(): void
    {
        $this->assertSame(90, config('queue.connections.database.retry_after'));
        $this->assertSame(3, config('queue.connections.database.max_tries'));
    }

    public function test_failed_job_summary_groups_failed_jobs_by_exception_class(): void
    {
        Schema::create('failed_jobs', function ($table): void {
            $table->id();
            $table->string('uuid')->nullable();
            $table->text('connection')->nullable();
            $table->text('queue')->nullable();
            $table->longText('payload')->nullable();
            $table->longText('exception');
            $table->timestamp('failed_at')->nullable();
        });

        DB::table('failed_jobs')->insert([
            [
                'uuid' => 'first-runtime',
                'exception' => RuntimeException::class.': SMTP rejected message',
            ],
            [
                'uuid' => 'second-runtime',
                'exception' => RuntimeException::class.': Timeout while sending',
            ],
            [
                'uuid' => 'invalid-argument',
                'exception' => \InvalidArgumentException::class.': Missing recipient',
            ],
        ]);

        $this->artisan('queue:failed-summary')
            ->expectsTable(
                ['Exception', 'Count'],
                [
                    [RuntimeException::class, 2],
                    [\InvalidArgumentException::class, 1],
                ],
            )
            ->assertSuccessful();
    }
}
