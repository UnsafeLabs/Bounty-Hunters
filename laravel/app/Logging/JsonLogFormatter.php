<?php

namespace App\Logging;

use DateTimeInterface;
use JsonException;
use Monolog\Formatter\JsonFormatter;
use Monolog\LogRecord;

class JsonLogFormatter extends JsonFormatter
{
    /**
     * @throws JsonException
     */
    public function format(LogRecord $record): string
    {
        return json_encode([
            'timestamp' => $record->datetime->format(DateTimeInterface::ATOM),
            'level' => $record->level->getName(),
            'message' => $record->message,
            'context' => $this->normalize($record->context),
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)."\n";
    }
}
