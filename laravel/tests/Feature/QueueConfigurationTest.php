<?php

namespace Tests\Feature;

use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Event;
use PHPUnit\Framework\Attributes\Group;
use Tests\TestCase;

#[Group('feature')]
class QueueConfigurationTest extends TestCase
{
    public function test_database_queue_retry_and_max_tries_are_configured(): void
    {
        $this->assertSame(90, config('queue.connections.database.retry_after'));
        $this->assertSame(3, config('queue.connections.database.max_tries'));
    }

    public function test_failed_job_listener_is_registered(): void
    {
        $this->assertTrue(Event::getFacadeRoot()->hasListeners(JobFailed::class));
    }
}
