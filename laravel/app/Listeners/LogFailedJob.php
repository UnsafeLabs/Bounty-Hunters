<?php

namespace App\Listeners;

use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Log;

class LogFailedJob
{
    /**
     * Handle the event.
     *
     * @param  \Illuminate\Queue\Events\JobFailed  $event
     * @return void
     */
    public function handle(JobFailed $event)
    {
        Log::error('Job failed', [
            'connection' => $event->connectionName,
            'queue' => $event->job->getQueue(),
            'job_class' => get_class($event->job),
            'payload' => $event->job->payload(),
            'exception' => [
                'class' => get_class($event->exception),
                'message' => $event->exception->getMessage(),
                'file' => $event->exception->getFile(),
                'line' => $event->exception->getLine(),
                'trace' => $event->exception->getTraceAsString(),
            ],
        ]);
    }
}