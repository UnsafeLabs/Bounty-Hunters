<?php

namespace Tests\Unit\Listeners;

use App\Listeners\LogFailedJob;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Log;
use Illuminate\Queue\Jobs\SyncJob;
use Mockery;
use Tests\TestCase;

class LogFailedJobTest extends TestCase
{
    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    public function test_logs_failed_job_details()
    {
        Log::spy();

        $exception = new \RuntimeException('Test exception message');

        $job = Mockery::mock(SyncJob::class);
        $job->shouldReceive('getQueue')->andReturn('default');
        $job->shouldReceive('payload')->andReturn(['data' => 'test']);

        $event = new JobFailed('database', $job, $exception);

        $listener = new LogFailedJob();
        $listener->handle($event);

        Log::shouldHaveReceived('error')->once()->with('Job failed', Mockery::on(function ($context) {
            return $context['connection'] === 'database'
                && $context['queue'] === 'default'
                && $context['payload'] === ['data' => 'test']
                && isset($context['exception'])
                && $context['exception']['class'] === 'RuntimeException'
                && $context['exception']['message'] === 'Test exception message'
                && isset($context['exception']['file'])
                && isset($context['exception']['line'])
                && isset($context['exception']['trace']);
        }));
    }
}