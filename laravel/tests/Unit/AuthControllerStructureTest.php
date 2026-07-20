<?php

namespace Tests\Unit;

use App\Http\Controllers\AuthController;
use PHPUnit\Framework\TestCase;
use ReflectionClass;
use ReflectionMethod;

/**
 * Structural tests for AuthController (issue #752).
 * Full HTTP/Sanctum integration requires a booted Laravel app + DB.
 */
class AuthControllerStructureTest extends TestCase
{
    public function test_auth_controller_has_register_login_logout(): void
    {
        $class = new ReflectionClass(AuthController::class);
        foreach (['register', 'login', 'logout'] as $method) {
            $this->assertTrue($class->hasMethod($method), "missing method $method");
            $m = $class->getMethod($method);
            $this->assertTrue($m->isPublic());
        }
    }

    public function test_api_routes_file_registers_auth_endpoints(): void
    {
        $path = dirname(__DIR__, 2).'/routes/api.php';
        $this->assertFileExists($path);
        $src = file_get_contents($path);
        $this->assertStringContainsString("/register", $src);
        $this->assertStringContainsString("/login", $src);
        $this->assertStringContainsString("/logout", $src);
        $this->assertStringContainsString('AuthController', $src);
        $this->assertStringContainsString('auth:sanctum', $src);
    }
}
