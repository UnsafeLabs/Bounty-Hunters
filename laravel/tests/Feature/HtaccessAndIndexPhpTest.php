<?php

namespace Tests\Feature;

use Tests\TestCase;

class HtaccessAndIndexPhpTest extends TestCase
{
    /**
     * Test index.php has ini_set for display_errors and expose_php.
     */
    public function testIndexPhpConfiguration()
    {
        $indexPhpPath = base_path('public/index.php');
        $this->assertFileExists($indexPhpPath);
        
        $content = file_get_contents($indexPhpPath);
        
        $this->assertStringContainsString("ini_set('display_errors', 'Off');", $content);
        $this->assertStringContainsString("ini_set('expose_php', 'Off');", $content);
    }

    /**
     * Test .htaccess has compression, expires and nosniff configurations.
     */
    public function testHtaccessConfiguration()
    {
        $htaccessPath = base_path('public/.htaccess');
        $this->assertFileExists($htaccessPath);
        
        $content = file_get_contents($htaccessPath);
        
        // Assert mod_deflate block
        $this->assertStringContainsString('<IfModule mod_deflate.c>', $content);
        $this->assertStringContainsString('AddOutputFilterByType DEFLATE', $content);
        $this->assertStringContainsString('text/html text/css application/javascript application/json image/svg+xml', $content);
        
        // Assert mod_expires block
        $this->assertStringContainsString('<IfModule mod_expires.c>', $content);
        $this->assertStringContainsString('ExpiresActive On', $content);
        $this->assertStringContainsString('ExpiresByType image/jpeg "access plus 30 days"', $content);
        $this->assertStringContainsString('ExpiresByType text/css "access plus 7 days"', $content);
        $this->assertStringContainsString('ExpiresByType font/woff2 "access plus 365 days"', $content);
        
        // Assert nosniff header
        $this->assertStringContainsString('<IfModule mod_headers.c>', $content);
        $this->assertStringContainsString('Header set X-Content-Type-Options nosniff', $content);
    }
}
