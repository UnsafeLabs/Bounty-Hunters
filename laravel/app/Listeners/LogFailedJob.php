<?php

namespace App\Listeners;

use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Log;

class LogFailedJob
{
    /**
     * Handle the event.
     */
    public function handle(JobFailed $event): void
    {
        Log::channel('error')->error('Job failed', [
            'connection' => $event->connectionName,
            'queue' => $event->job->getQueue(),
            'exception_class' => get_class($event->exception),
            'exception_message' => $event->exception->getMessage(),
            'payload' => $event->job->payload(),
            'job_id' => $event->job->getJobId(),
            'failed_at' => now()->toIso8601String(),
        ]);
    }
}
