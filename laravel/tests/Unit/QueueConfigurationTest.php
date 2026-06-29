<?php

namespace Tests\Unit;

use Tests\TestCase;

class QueueConfigurationTest extends TestCase
{
    public function test_database_queue_has_retry_timeout_and_max_tries(): void
    {
        $this->assertSame(90, config('queue.connections.database.retry_after'));
        $this->assertSame(3, config('queue.connections.database.max_tries'));
    }
}
