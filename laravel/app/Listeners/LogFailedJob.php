<?php

namespace App\Listeners;

use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Log;

class LogFailedJob
{
    public function handle(JobFailed $event): void
    {
        Log::error('Job failed', [
            'exception' => $event->exception?->getMessage(),
            'queue' => $event->job->getQueue(),
            'payload' => $event->job->getRawBody(),
            'connection' => $event->connectionName,
        ]);
    }
}
