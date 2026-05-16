<?php

namespace Tests\Feature;

use Tests\TestCase;

class SessionFallbackTest extends TestCase
{
    public function test_session_fallback_driver_defaults_to_file(): void
    {
        $this->assertSame('file', config('session.fallback'));
    }
}
