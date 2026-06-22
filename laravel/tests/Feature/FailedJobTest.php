<?php

namespace Tests\Feature;

use App\Listeners\LogFailedJob;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class FailedJobTest extends TestCase
{
    public function test_listener_logs_job_failure()
    {
        Log::shouldReceive("error")
            ->once()
            ->withArgs(fn($msg, $ctx) => $msg === "Job failed");

        $event = new JobFailed(
            "test-connection",
            new \stdClass(),
            new \RuntimeException("Test failure")
        );

        $listener = new LogFailedJob();
        $listener->handle($event);
    }

    public function test_command_runs_when_no_failed_jobs()
    {
        $this->artisan("queue:failed-summary")
            ->assertSuccessful();
    }
}
