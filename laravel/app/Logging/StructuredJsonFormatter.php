<?php

namespace App\Logging;

use Monolog\Formatter\NormalizerFormatter;
use Monolog\LogRecord;

class StructuredJsonFormatter extends NormalizerFormatter
{
    public function format(LogRecord $record): string
    {
        $payload = [
            'timestamp' => $record->datetime->format('c'),
            'level' => $record->level->getName(),
            'message' => $record->message,
            'context' => $record->context,
            'channel' => $record->channel,
            'extra' => $record->extra,
        ];

        return $this->toJson($this->normalize($payload), true)."\n";
    }
}
