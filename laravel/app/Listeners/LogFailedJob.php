<?php

namespace App\Listeners;

use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Log;

class LogFailedJob
{
    /**
     * Create the event listener.
     */
    public function __construct()
    {
        //
    }

    /**
     * Handle the event.
     */
    public function handle(JobFailed $event): void
    {
        Log::error('Queue job failed: ' . $event->exception->getMessage(), [
            'connection' => $event->connectionName,
            'queue' => $event->job->getQueue(),
            'payload' => $event->job->getRawBody(),
            'exception' => $event->exception,
        ]);
    }
}
