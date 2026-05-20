<?php

namespace App\Listeners;

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
            'job_id' => $event->job->getJobId(),
            'job_name' => $event->job->resolveName(),
            'payload' => $event->job->payload(),
            'exception' => $this->formatException($event->exception),
        ]);
    }

    /**
     * @return array{class: class-string<Throwable>, message: string, code: int|string, file: string, line: int, trace: string}
     */
    private function formatException(Throwable $exception): array
    {
        return [
            'class' => $exception::class,
            'message' => $exception->getMessage(),
            'code' => $exception->getCode(),
            'file' => $exception->getFile(),
            'line' => $exception->getLine(),
            'trace' => $exception->getTraceAsString(),
        ];
    }
}
