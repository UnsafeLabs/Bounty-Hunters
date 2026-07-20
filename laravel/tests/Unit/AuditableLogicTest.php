<?php

/**
 * Pure logic tests for audit field exclusion and event shapes (#786).
 */

function assert_true(bool $c, string $m): void
{
    if (! $c) {
        fwrite(STDERR, "FAIL $m\n");
        exit(1);
    }
    echo "ok $m\n";
}

$exclude = ['password', 'remember_token', 'two_factor_secret', 'two_factor_recovery_codes'];

function audit_attrs(array $attrs, array $exclude): array
{
    foreach ($exclude as $f) {
        unset($attrs[$f]);
    }

    return $attrs;
}

$created = audit_attrs([
    'id' => 1,
    'name' => 'Ada',
    'email' => 'a@x.com',
    'password' => 'secret-hash',
], $exclude);
assert_true(! isset($created['password']), 'password excluded on create');
assert_true($created['email'] === 'a@x.com', 'email kept');

// update diff
$original = ['name' => 'Ada', 'email' => 'a@x.com', 'password' => 'h1'];
$changes = ['name' => 'Ada Lovelace', 'password' => 'h2', 'updated_at' => 'now'];
$old = [];
$new = [];
foreach ($changes as $k => $v) {
    if (in_array($k, $exclude, true) || $k === 'updated_at') {
        continue;
    }
    $old[$k] = $original[$k];
    $new[$k] = $v;
}
assert_true($old === ['name' => 'Ada'] && $new === ['name' => 'Ada Lovelace'], 'update only name');

// reverse chrono history
$logs = [['id' => 1], ['id' => 3], ['id' => 2]];
usort($logs, fn ($a, $b) => $b['id'] <=> $a['id']);
assert_true(array_column($logs, 'id') === [3, 2, 1], 'reverse chrono');

$root = dirname(__DIR__, 2);
foreach ([
    'app/Traits/Auditable.php',
    'app/Models/AuditLog.php',
    'database/migrations/2026_07_20_000030_create_audit_logs_table.php',
] as $rel) {
    assert_true(is_file($root . '/' . $rel), "present $rel");
}
$trait = file_get_contents($root . '/app/Traits/Auditable.php');
foreach (['created', 'updated', 'deleted', 'getAuditHistory', 'password'] as $n) {
    assert_true(strpos($trait, $n) !== false, "trait has $n");
}
$user = file_get_contents($root . '/app/Models/User.php');
assert_true(strpos($user, 'Auditable') !== false, 'User uses Auditable');

echo "ALL PASSED\n";
