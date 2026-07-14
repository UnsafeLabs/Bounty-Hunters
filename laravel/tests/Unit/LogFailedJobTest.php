<?php

namespace Tests\Unit;

use App\Listeners\LogFailedJob;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class LogFailedJobTest extends TestCase
{
    public function test_listener_logs_job_failure_details(): void
    {
        Log::shouldReceive('channel')
            ->once()
            ->with('error')
            ->andReturnSelf();
        Log::shouldReceive('error')
            ->once()
            ->with('Job failed', \Mockery::on(function (array $context) {
                return isset($context['connection'])
                    && isset($context['queue'])
                    && isset($context['exception_class'])
                    && isset($context['exception_message'])
                    && isset($context['payload'])
                    && isset($context['job_id']);
            }));

        $exception = new \RuntimeException('Test failure');
        $job = \Mockery::mock();
        $job->shouldReceive('getQueue')->andReturn('default');
        $job->shouldReceive('payload')->andReturn(['data' => 'test']);
        $job->shouldReceive('getJobId')->andReturn('abc-123');

        $event = new JobFailed('database', $job, $exception);

        $listener = new LogFailedJob();
        $listener->handle($event);

        $this->assertTrue(true); // no exception = pass
    }
}
