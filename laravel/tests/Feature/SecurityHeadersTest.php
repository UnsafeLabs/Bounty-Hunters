<?php

namespace Tests\Feature;

use Tests\TestCase;

class SecurityHeadersTest extends TestCase
{
    public function test_welcome_response_includes_csrf_meta_tag_and_security_headers(): void
    {
        $response = $this->get('/');

        $response->assertOk();
        $response->assertSee('<meta name="csrf-token" content="', false);
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
        $response->assertHeader('X-Frame-Options', 'DENY');
        $response->assertHeader('X-XSS-Protection', '1; mode=block');
        $response->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    }
}
