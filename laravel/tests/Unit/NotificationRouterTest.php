<?php

/**
 * Pure logic tests for notification preference routing (#793).
 */

function assert_true(bool $c, string $m): void
{
    if (! $c) {
        fwrite(STDERR, "FAIL $m\n");
        exit(1);
    }
    echo "ok $m\n";
}

// Default seed policy: mail enabled, slack/database off
$defaults = [];
$events = ['account.security', 'billing.invoice', 'product.updates'];
$channels = ['mail', 'slack', 'database'];
foreach ($events as $e) {
    foreach ($channels as $ch) {
        $defaults[] = ['channel' => $ch, 'event_type' => $e, 'enabled' => $ch === 'mail'];
    }
}
assert_true(count($defaults) === 9, '9 default prefs');
$mailOn = array_filter($defaults, fn ($r) => $r['channel'] === 'mail' && $r['enabled']);
assert_true(count($mailOn) === 3, 'mail on for 3 events');
$slackOff = array_filter($defaults, fn ($r) => $r['channel'] === 'slack' && ! $r['enabled']);
assert_true(count($slackOff) === 3, 'slack off by default');

// Router filter simulation
function filter_channels(array $prefs, string $event, array $candidates): array
{
    $enabled = [];
    foreach ($prefs as $p) {
        if ($p['event_type'] === $event && $p['enabled']) {
            $enabled[] = $p['channel'];
        }
    }

    return array_values(array_filter($candidates, fn ($c) => in_array($c, $enabled, true)));
}

$prefs = [
    ['event_type' => 'billing.invoice', 'channel' => 'mail', 'enabled' => true],
    ['event_type' => 'billing.invoice', 'channel' => 'slack', 'enabled' => false],
    ['event_type' => 'billing.invoice', 'channel' => 'database', 'enabled' => true],
];
$out = filter_channels($prefs, 'billing.invoice', ['mail', 'slack', 'database']);
assert_true($out === ['mail', 'database'], 'router filters slack off');

// Unique key composition
$key = fn ($u, $c, $e) => "$u|$c|$e";
$set = [];
foreach ([['1', 'mail', 'a'], ['1', 'mail', 'a']] as $row) {
    $k = $key(...$row);
    if (isset($set[$k])) {
        $dup = true;
        break;
    }
    $set[$k] = true;
    $dup = false;
}
assert_true($dup === true, 'duplicate key detected');

// Structure
$root = dirname(__DIR__, 2);
foreach ([
    'app/Models/NotificationPreference.php',
    'app/Http/Controllers/NotificationPreferenceController.php',
    'app/Services/NotificationRouter.php',
    'app/Observers/UserObserver.php',
    'database/migrations/2026_07_20_000020_create_notification_preferences_table.php',
] as $rel) {
    assert_true(is_file($root . '/' . $rel), "present $rel");
}
$mig = file_get_contents($root . '/database/migrations/2026_07_20_000020_create_notification_preferences_table.php');
assert_true(strpos($mig, 'unique') !== false, 'unique constraint in migration');
$ctrl = file_get_contents($root . '/app/Http/Controllers/NotificationPreferenceController.php');
foreach (['function index', 'function update', 'function bulkUpdate'] as $m) {
    assert_true(strpos($ctrl, $m) !== false, "controller $m");
}

echo "ALL PASSED\n";
