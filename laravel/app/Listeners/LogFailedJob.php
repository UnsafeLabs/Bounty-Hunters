<?php

namespace App\Listeners;

use Illuminate\Contracts\Queue\Job;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Log;

class LogFailedJob
{
    /**
     * Handle the event.
     */
    public function handle(JobFailed $event): void
    {
        $exception = $event->exception;
        $job = $event->job;

        Log::error('Job failed', [
            'job' => $event->connectionName,
            'queue' => $job->getQueue(),
            'exception' => $exception->getMessage(),
            'exception_class' => $exception::class,
            'payload' => $job->payload(),
            'failed_at' => now()->toIso8601String(),
        ]);
    }
}
