<?php

namespace App\Logging;

use Monolog\Formatter\FormatterInterface;
use Monolog\LogRecord;

final class JsonLogFormatter implements FormatterInterface
{
    public function format(LogRecord $record): string
    {
        return json_encode([
            'timestamp' => $record->datetime->format(DATE_ATOM),
            'level' => $record->level->getName(),
            'message' => $record->message,
            'context' => $record->context,
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    }

    /**
     * @param  array<LogRecord>  $records
     */
    public function formatBatch(array $records): string
    {
        $formatted = '';

        foreach ($records as $record) {
            $formatted .= $this->format($record);
        }

        return $formatted;
    }
}
