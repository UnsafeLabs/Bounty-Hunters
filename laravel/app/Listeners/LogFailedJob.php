<?php

namespace App\Listeners;

use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Log;

class LogFailedJob
{
    public function handle(JobFailed $event): void
    {
        $payload = $event->job->payload();

        Log::error('Queue job failed', [
            'connection' => $event->connectionName,
            'queue' => $event->job->getQueue(),
            'job' => $payload['displayName'] ?? $payload['job'] ?? null,
            'payload' => $payload,
            'exception_class' => $event->exception::class,
            'exception_message' => $event->exception->getMessage(),
            'exception_trace' => $event->exception->getTraceAsString(),
        ]);
    }
}
