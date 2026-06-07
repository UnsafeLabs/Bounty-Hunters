import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const service = readFileSync(new URL('./app/Services/CacheHealthCheck.php', import.meta.url), 'utf8');
const command = readFileSync(new URL('./app/Console/Commands/CacheStatusCommand.php', import.meta.url), 'utf8');
const config = readFileSync(new URL('./config/cache.php', import.meta.url), 'utf8');
const routes = readFileSync(new URL('./routes/web.php', import.meta.url), 'utf8');
const serviceTest = readFileSync(new URL('./tests/Unit/CacheHealthCheckTest.php', import.meta.url), 'utf8');
const commandTest = readFileSync(new URL('./tests/Feature/CacheStatusCommandTest.php', import.meta.url), 'utf8');

function includes(source, fragment, message) {
  assert.ok(source.includes(fragment), message);
}

function matches(source, pattern, message) {
  assert.ok(pattern.test(source), message);
}

includes(service, 'class CacheHealthCheck', 'CacheHealthCheck service should exist');
includes(service, "config('cache.default')", 'service should use active cache store');
includes(service, 'Cache::store($storeName)', 'service should test selected store connection');
includes(service, "'available' => $available", 'service should report availability');
includes(service, "'driver' => $driver", 'service should report driver');
includes(service, "'latency_ms' => round(", 'service should report latency in ms');
includes(service, 'cache round-trip verification failed', 'service should report a message when cache round-trip fails');
includes(service, "config('cache.health_check_enabled', true)", 'service should respect enabled config');
includes(service, "config('cache.health_check_interval', 300)", 'service should respect interval config');
includes(command, "protected $signature = 'cache:status", 'artisan command should be cache:status');
includes(command, "Driver: '.$status['driver']", 'command should output driver');
includes(command, "Available: '.($status['available'] ? 'yes' : 'no')", 'command should output availability');
includes(command, "Latency: '.$status['latency_ms'].'ms'", 'command should output latency');
includes(config, "'health_check_enabled' => env('CACHE_HEALTH_CHECK_ENABLED', true)", 'config should include health_check_enabled default true');
includes(config, "'health_check_interval' => env('CACHE_HEALTH_CHECK_INTERVAL', 300)", 'config should include interval default 300');
includes(routes, "Route::get('/health/cache'", 'health endpoint should exist');
includes(routes, "$status['available'] ? 200 : 503", 'endpoint should return 200 or 503 based on availability');
includes(serviceTest, 'test_reports_available_cache_store', 'service tests should cover available cache');
includes(serviceTest, 'test_reports_unavailable_store_when_connection_fails', 'service tests should cover unavailable cache stores');
includes(serviceTest, 'test_respects_disabled_health_check_config', 'service tests should cover config');
includes(commandTest, 'test_cache_status_command_outputs_driver_availability_and_latency', 'command tests should exist');
includes(commandTest, 'test_cache_status_command_fails_when_store_is_unavailable', 'command tests should cover unavailable stores');
includes(commandTest, 'test_cache_health_endpoint_returns_healthy_json', 'endpoint tests should cover healthy JSON');
includes(commandTest, 'test_cache_health_endpoint_returns_503_when_unavailable', 'endpoint tests should cover unavailable JSON');
matches(command, /return \$status\['available'\] \? self::SUCCESS : self::FAILURE;/, 'command should fail when unavailable');

const metadata = JSON.parse(readFileSync(new URL('./app/Services/_provenance.json', import.meta.url), 'utf8'));
assert.equal(metadata.tool_name, 'Codex GPT-5');
assert.ok(!metadata.boot_context.includes('You are'), 'metadata must not leak private prompts');

console.log('laravel cache health checks passed');
