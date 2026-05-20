<?php

namespace Tests\Feature;

use Tests\TestCase;

class SecurityHeadersTest extends TestCase
{
    public function test_welcome_page_contains_csrf_meta_tag(): void
    {
        $response = $this->get('/');

        $response->assertOk();
        $response->assertSee('<meta name="csrf-token"', false);
    }

    public function test_security_headers_are_applied_to_web_responses(): void
    {
        $response = $this->get('/');

        $response->assertOk();
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
        $response->assertHeader('X-Frame-Options', 'DENY');
        $response->assertHeader('X-XSS-Protection', '1; mode=block');
        $response->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    }
}
