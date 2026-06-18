<?php

namespace App\Logging;

use Monolog\Formatter\FormatterInterface;
use Monolog\LogRecord;

class JsonLogFormatter implements FormatterInterface
{
    public function format(LogRecord $record): string
    {
        return json_encode([
            'timestamp' => $record->datetime->format(DATE_ATOM),
            'level' => $record->level->getName(),
            'message' => $record->message,
            'context' => $record->context,
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE).PHP_EOL;
    }

    /**
     * @param  array<int, LogRecord>  $records
     */
    public function formatBatch(array $records): string
    {
        return implode('', array_map(fn (LogRecord $record): string => $this->format($record), $records));
    }
}
