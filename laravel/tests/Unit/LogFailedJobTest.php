<?php

namespace Tests\Unit;

use App\Listeners\LogFailedJob;
use Exception;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Queue\Jobs\Job;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\TestCase;

class LogFailedJobTest extends TestCase
{
    public function test_listener_logs_failed_job_metadata(): void
    {
        $job = Mockery::mock(Job::class);
        $job->shouldReceive('getQueue')->once()->andReturn('emails');
        $job->shouldReceive('payload')->once()->andReturn([
            'uuid' => 'job-uuid',
            'displayName' => 'SendWelcomeEmail',
        ]);
        $exception = new Exception('SMTP connection failed');

        Log::shouldReceive('error')
            ->once()
            ->with(
                'Queued job failed',
                Mockery::on(function (array $context) use ($exception): bool {
                    return $context['connection'] === 'database'
                        && $context['queue'] === 'emails'
                        && $context['payload']['uuid'] === 'job-uuid'
                        && $context['payload']['displayName'] === 'SendWelcomeEmail'
                        && $context['exception']['class'] === Exception::class
                        && $context['exception']['message'] === 'SMTP connection failed'
                        && $context['exception']['file'] === $exception->getFile()
                        && $context['exception']['line'] === $exception->getLine()
                        && array_key_exists('trace', $context['exception']);
                }),
            );

        (new LogFailedJob())->handle(new JobFailed('database', $job, $exception));
    }
}
