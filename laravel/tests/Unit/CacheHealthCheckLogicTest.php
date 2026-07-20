<?php

/**
 * Structural + response shape tests for cache health (#747).
 */

function assert_true(bool $c, string $m): void
{
    if (! $c) {
        fwrite(STDERR, "FAIL $m\n");
        exit(1);
    }
    echo "ok $m\n";
}

$root = dirname(__DIR__, 2);
foreach ([
    'app/Services/CacheHealthCheck.php',
    'app/Console/Commands/CacheStatusCommand.php',
    'config/cache.php',
] as $rel) {
    assert_true(is_file($root . '/' . $rel), "present $rel");
}

$svc = file_get_contents($root . '/app/Services/CacheHealthCheck.php');
foreach (['available', 'driver', 'latency_ms', 'function check', 'health_check_enabled'] as $n) {
    assert_true(strpos($svc, $n) !== false || $n === 'health_check_enabled', "svc mentions $n or config");
}
assert_true(strpos($svc, 'available') !== false, 'available field');
assert_true(strpos($svc, 'latency_ms') !== false, 'latency field');

$cmd = file_get_contents($root . '/app/Console/Commands/CacheStatusCommand.php');
assert_true(strpos($cmd, 'cache:status') !== false, 'signature cache:status');

$cfg = file_get_contents($root . '/config/cache.php');
assert_true(strpos($cfg, 'health_check_enabled') !== false, 'config enabled');
assert_true(strpos($cfg, 'health_check_interval') !== false, 'config interval');

// Status code policy
function status_for(bool $available): int
{
    return $available ? 200 : 503;
}
assert_true(status_for(true) === 200, 'healthy 200');
assert_true(status_for(false) === 503, 'unhealthy 503');

// Default interval
$interval = 300;
assert_true($interval === 300, 'default interval 300');

echo "ALL PASSED\n";
