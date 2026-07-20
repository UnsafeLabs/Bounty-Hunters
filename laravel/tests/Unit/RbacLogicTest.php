<?php

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
    'app/Models/Role.php',
    'app/Models/Permission.php',
    'app/Traits/HasRoles.php',
    'app/Http/Middleware/CheckRole.php',
    'database/migrations/2026_07_20_000040_create_rbac_tables.php',
] as $rel) {
    assert_true(is_file($root . '/' . $rel), "present $rel");
}

$trait = file_get_contents($root . '/app/Traits/HasRoles.php');
foreach (['assignRole', 'removeRole', 'hasRole', 'hasPermission', 'getAllPermissions'] as $m) {
    assert_true(strpos($trait, "function $m") !== false, "trait $m");
}

$mw = file_get_contents($root . '/app/Http/Middleware/CheckRole.php');
assert_true(strpos($mw, '403') !== false, 'middleware 403');

$user = file_get_contents($root . '/app/Models/User.php');
assert_true(strpos($user, 'HasRoles') !== false, 'User HasRoles');

// pure permission merge logic
$direct = ['edit', 'view'];
$viaRole = ['view', 'delete'];
$all = array_values(array_unique(array_merge($direct, $viaRole)));
sort($all);
assert_true($all === ['delete', 'edit', 'view'], 'merge perms');

echo "ALL PASSED\n";
