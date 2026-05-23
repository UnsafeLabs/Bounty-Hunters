<?php

namespace App\Logging;

use Monolog\Formatter\JsonFormatter;
use Monolog\Logger;

class JsonLogFormatter
{
    public function __invoke(Logger $logger): void
    {
        foreach ($logger->getHandlers() as $handler) {
            $handler->setFormatter(
                new JsonFormatter(JsonFormatter::BATCH_MODE_JSON, true)
            );
        }
    }
}
