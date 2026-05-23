<?php

namespace Tests\Feature;

use Tests\TestCase;

class SecurityHeadersTest extends TestCase
{
    /** @test */
    public function welcome_page_contains_csrf_meta_tag(): void
    {
        \$response = \$this->get('/');

        \$response->assertStatus(200);
        \$response->assertSee('<meta name="csrf-token" content="', false);
    }

    /** @test */
    public function security_headers_are_present_in_response(): void
    {
        \$response = \$this->get('/');

        \$response->assertHeader('X-Content-Type-Options', 'nosniff');
        \$response->assertHeader('X-Frame-Options', 'DENY');
        \$response->assertHeader('X-XSS-Protection', '1; mode=block');
        \$response->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    }
}
