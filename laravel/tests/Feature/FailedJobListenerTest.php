<?php

namespace Tests\Feature;

use App\Jobs\TestJob;
use App\Listeners\LogFailedJob;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\TestCase;

class FailedJobListenerTest extends TestCase
{
    public function test_failed_job_listener_is_registered(): void
    {
        Event::fake();

        // Verify the listener is registered for the JobFailed event
        // by checking the event system
        $this->assertTrue(
            Event::hasListeners(JobFailed::class)
        );
    }

    public function test_failed_job_listener_logs_job_details(): void
    {
        Log::shouldReceive('error')
            ->once()
            ->with('Job failed', Mockery::subset([
                'job' => 'database',
                'queue' => 'default',
                'exception' => 'Test failure',
            ]));

        $job = Mockery::mock('Illuminate\Contracts\Queue\Job');
        $job->shouldReceive('getQueue')->andReturn('default');
        $job->shouldReceive('payload')->andReturn(['data' => 'test']);

        $event = new JobFailed(
            'database',
            $job,
            new \RuntimeException('Test failure')
        );

        $listener = new LogFailedJob();
        $listener->handle($event);

        // Assertions are in the shouldReceive above
        $this->assertTrue(true);
    }

    public function test_queue_config_has_correct_values(): void
    {
        $config = config('queue.connections.database');

        $this->assertEquals(90, $config['retry_after']);
        $this->assertEquals(3, $config['max_tries']);
    }
}
