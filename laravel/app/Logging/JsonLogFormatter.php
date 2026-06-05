<?php

namespace App\Logging;

use Monolog\Formatter\NormalizerFormatter;
use Monolog\LogRecord;

class JsonLogFormatter extends NormalizerFormatter
{
    /**
     * Format a log record as one JSON object per line.
     */
    public function format(LogRecord $record): string
    {
        return $this->toJson([
            'timestamp' => $record->datetime->format('c'),
            'level' => $record->level->getName(),
            'message' => $record->message,
            'context' => $record->context,
        ], true).PHP_EOL;
    }
}
