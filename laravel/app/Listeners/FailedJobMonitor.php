<?php

namespace App\Listeners;

use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

class FailedJobMonitor
{
    public function handle(JobFailed $event): void
    {
        Log::error('Job failed', [
            'job' => $event->job->getName(),
            'connection' => $event->connectionName,
            'queue' => $event->job->getQueue(),
            'exception' => $event->exception->getMessage(),
            'attempts' => $event->job->attempts(),
        ]);

        $key = 'failed_jobs:' . $event->job->getName();
        $count = Cache::get($key, 0) + 1;
        Cache::put($key, $count, now()->addHours(24));

        if ($count >= 5) {
            Log::critical("Job {$event->job->getName()} has failed {$count} times in 24 hours");
        }
    }
}
