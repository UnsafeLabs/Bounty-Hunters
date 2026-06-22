<?php

namespace App\Listeners;

use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Log;

class LogFailedJob
{
    public function handle(JobFailed $event): void
    {
        Log::error("Job failed", [
            "job" => $event->job->resolveName(),
            "queue" => $event->connectionName,
            "exception" => get_class($event->exception),
            "message" => $event->exception->getMessage(),
            "payload" => $event->job->payload(),
        ]);
    }
}
