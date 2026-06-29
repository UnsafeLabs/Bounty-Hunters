<?php

namespace App\Listeners;

use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Log;
use Throwable;

class LogFailedJob
{
    public function handle(JobFailed $event): void
    {
        $job = $event->job;
        $exception = $event->exception;

        Log::error('Queued job failed', [
            'connection' => $event->connectionName,
            'queue' => $job !== null && method_exists($job, 'getQueue')
                ? $job->getQueue()
                : null,
            'payload' => $job !== null && method_exists($job, 'payload')
                ? $job->payload()
                : null,
            'exception' => $this->exceptionContext($exception),
        ]);
    }

    /**
     * @return array{class: class-string<Throwable>, message: string, file: string, line: int, trace: string}
     */
    private function exceptionContext(Throwable $exception): array
    {
        return [
            'class' => $exception::class,
            'message' => $exception->getMessage(),
            'file' => $exception->getFile(),
            'line' => $exception->getLine(),
            'trace' => $exception->getTraceAsString(),
        ];
    }
}
