<?php

namespace App\Listeners;

use Illuminate\Support\Facades\Log;
use Throwable;

class LogFailedJob
{
    /**
     * Handle the failed job event.
     */
    public function handle($event): void
    {
        $exception = $event->exception;

        Log::error('Queue job failed', [
            'connection' => $event->connectionName,
            'queue' => $event->job->getQueue(),
            'job_id' => $event->job->getJobId(),
            'job' => $event->job->resolveName(),
            'payload' => $event->job->payload(),
            'exception_class' => $exception::class,
            'exception_message' => $exception->getMessage(),
            'exception_file' => $exception->getFile(),
            'exception_line' => $exception->getLine(),
            'exception_trace' => $this->formatTrace($exception),
        ]);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function formatTrace(Throwable $exception): array
    {
        return $exception->getTrace();
    }
}
