<?php

namespace App\Listeners;

use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Log;

class LogFailedJob
{
    public function handle(JobFailed $event): void
    {
        $payload = method_exists($event->job, 'payload')
            ? $event->job->payload()
            : [];

        Log::error('Queue job failed', [
            'connection' => $event->connectionName,
            'queue' => method_exists($event->job, 'getQueue')
                ? $event->job->getQueue()
                : null,
            'job' => method_exists($event->job, 'resolveName')
                ? $event->job->resolveName()
                : get_class($event->job),
            'payload' => $payload,
            'exception' => get_class($event->exception),
            'message' => $event->exception->getMessage(),
            'trace' => $event->exception->getTraceAsString(),
        ]);
    }
}
