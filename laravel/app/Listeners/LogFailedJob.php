<?php

namespace App\Listeners;

use Illuminate\Contracts\Queue\Job;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Log;
use Throwable;

class LogFailedJob
{
    public function handle(JobFailed $event): void
    {
        Log::error('Queue job failed', [
            'connection' => $event->connectionName,
            'queue' => $event->job->getQueue(),
            'job' => $event->job->resolveName(),
            'payload' => $this->payload($event->job),
            'exception' => [
                'class' => get_class($event->exception),
                'message' => $event->exception->getMessage(),
                'file' => $event->exception->getFile(),
                'line' => $event->exception->getLine(),
                'trace' => $event->exception->getTraceAsString(),
            ],
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(Job $job): array
    {
        try {
            return $job->payload();
        } catch (Throwable $exception) {
            return [
                'payload_error' => $exception->getMessage(),
            ];
        }
    }
}
