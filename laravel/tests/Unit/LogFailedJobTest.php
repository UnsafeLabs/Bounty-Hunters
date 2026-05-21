<?php

namespace Tests\Unit;

use App\Listeners\LogFailedJob;
use Illuminate\Contracts\Queue\Job;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Log;
use Mockery;
use PHPUnit\Framework\Attributes\Group;
use Tests\TestCase;

#[Group('unit')]
class LogFailedJobTest extends TestCase
{
    public function test_listener_logs_failed_job_metadata(): void
    {
        $exception = new \RuntimeException('Queue exploded', 123);
        $job = Mockery::mock(Job::class);

        $job->shouldReceive('getQueue')->once()->andReturn('emails');
        $job->shouldReceive('getJobId')->once()->andReturn('job-123');
        $job->shouldReceive('resolveName')->once()->andReturn('App\\Jobs\\SendEmail');
        $job->shouldReceive('payload')->once()->andReturn([
            'displayName' => 'App\\Jobs\\SendEmail',
            'data' => ['user_id' => 42],
        ]);

        Log::shouldReceive('error')
            ->once()
            ->with('Queued job failed.', Mockery::on(function (array $context) {
                return $context['connection'] === 'database'
                    && $context['queue'] === 'emails'
                    && $context['job_id'] === 'job-123'
                    && $context['job_name'] === 'App\\Jobs\\SendEmail'
                    && $context['payload']['data']['user_id'] === 42
                    && $context['exception']['class'] === \RuntimeException::class
                    && $context['exception']['message'] === 'Queue exploded'
                    && $context['exception']['code'] === 123
                    && is_string($context['exception']['trace']);
            }));

        (new LogFailedJob)->handle(new JobFailed('database', $job, $exception));
    }
}
