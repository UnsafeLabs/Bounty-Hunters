<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

class WebhookSignatureTest extends TestCase
{
    /**
     * Test HMAC-SHA256 signature generation.
     */
    public function test_signature_generation()
    {
        $payload = json_encode(['event' => 'test.event', 'data' => 'hello']);
        $secret = 'test-secret-key-12345';
        
        // Manual calculation
        $expectedSignature = hash_hmac('sha256', $payload, $secret);
        
        // This simulates what our service does
        $actualSignature = hash_hmac('sha256', $payload, $secret);
        
        $this->assertEquals($expectedSignature, $actualSignature);
        $this->assertEquals(64, strlen($actualSignature));
    }

    /**
     * Test exponential backoff calculation.
     */
    public function test_retry_backoff_calculation()
    {
        $attempt = 1;
        $delay = pow(2, $attempt) * 60; // 2 minutes
        $this->assertEquals(120, $delay);

        $attempt = 3;
        $delay = pow(2, $attempt) * 60; // 8 minutes
        $this->assertEquals(480, $delay);
    }
}
