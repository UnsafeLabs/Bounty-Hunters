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
    'app/Notifications/CustomVerifyEmail.php',
    'app/Http/Middleware/EnsureEmailIsVerified.php',
    'resources/views/auth/verify-email.blade.php',
    'routes/web.php',
    'app/Services/FallbackMailer.php',
    'config/mail.php',
    '.audit.json',
] as $rel) {
    assert_true(is_file($root . '/' . $rel), "present $rel");
}

$user = file_get_contents($root . '/app/Models/User.php');
assert_true(strpos($user, 'MustVerifyEmail') !== false, 'User MustVerifyEmail');
assert_true(strpos($user, 'sendEmailVerificationNotification') !== false, 'custom notify hook');

$routes = file_get_contents($root . '/routes/web.php');
assert_true(strpos($routes, 'email/verify/{id}/{hash}') !== false, 'verify route');
assert_true(strpos($routes, 'verification-notification') !== false, 'resend route');
assert_true(strpos($routes, 'throttle:1,1') !== false, 'rate limit 1/min');

$mail = file_get_contents($root . '/config/mail.php');
assert_true(strpos($mail, 'fallback_mailer') !== false, 'fallback_mailer config');

$mw = file_get_contents($root . '/app/Http/Middleware/EnsureEmailIsVerified.php');
assert_true(strpos($mw, 'hasVerifiedEmail') !== false, 'middleware checks verified');

echo "ALL PASSED\n";
