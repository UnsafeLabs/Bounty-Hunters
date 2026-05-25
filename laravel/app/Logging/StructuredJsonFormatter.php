<?php

namespace App\Logging;

use Monolog\Formatter\JsonFormatter;
use Monolog\LogRecord;

class StructuredJsonFormatter extends JsonFormatter
{
    public function format(LogRecord $record): string
    {
        return $this->toJson([
            'timestamp' => $record->datetime->format(DATE_ATOM),
            'level' => $record->level->getName(),
            'message' => $record->message,
            'context' => $record->context,
        ])."\n";
    }
}
