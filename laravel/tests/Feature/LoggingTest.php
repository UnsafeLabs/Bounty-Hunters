<?php

namespace Tests\Feature;

use Tests\TestCase;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\File;

class LoggingTest extends TestCase
{
    public function test_logging_configuration()
    {
        // Define paths
        $date = date('Y-m-d');
        $dailyLogPath = storage_path('logs/laravel-' . $date . '.log');
        $errorLogPath = storage_path('logs/error.log');
        $jsonLogPath = storage_path('logs/laravel-json.log');

        // Clear existing files for clean test
        if (File::exists($dailyLogPath)) File::delete($dailyLogPath);
        if (File::exists($errorLogPath)) File::delete($errorLogPath);
        if (File::exists($jsonLogPath)) File::delete($jsonLogPath);

        // Test stack channel
        Log::channel('stack')->info('Test info message');
        Log::channel('stack')->error('Test error message');

        $this->assertTrue(File::exists($dailyLogPath));
        $dailyContent = File::get($dailyLogPath);
        $this->assertStringContainsString('Test info message', $dailyContent);
        $this->assertStringContainsString('Test error message', $dailyContent);

        $this->assertTrue(File::exists($errorLogPath));
        $errorContent = File::get($errorLogPath);
        $this->assertStringNotContainsString('Test info message', $errorContent);
        $this->assertStringContainsString('Test error message', $errorContent);

        // Test json channel
        Log::channel('json')->info('Test json message', ['foo' => 'bar']);
        $this->assertTrue(File::exists($jsonLogPath));
        $jsonContent = File::get($jsonLogPath);
        $this->assertStringContainsString('Test json message', $jsonContent);
        $this->assertStringContainsString('"foo":"bar"', $jsonContent);
        
        $jsonDecoded = json_decode(trim(explode("\n", $jsonContent)[0]), true);
        $this->assertIsArray($jsonDecoded);
        $this->assertArrayHasKey('message', $jsonDecoded);
        $this->assertArrayHasKey('level_name', $jsonDecoded);
        $this->assertArrayHasKey('datetime', $jsonDecoded);
    }
}
