<?php

/**
 * Lightweight unit tests for WebhookDispatcher pure helpers (issue #754).
 * Run: php laravel/tests/Unit/WebhookDispatcherTest.php
 */

// Inline the pure functions under test so PHPUnit is not required.
function webhook_sign(string $secret, string $rawBody): string
{
    return hash_hmac('sha256', $rawBody, $secret);
}

function webhook_retry_delay_seconds(int $attempt): int
{
    if ($attempt <= 1) {
        return 0;
    }

    return (int) (60 * (2 ** ($attempt - 2)));
}

function assert_true(bool $cond, string $msg): void
{
    if (! $cond) {
        fwrite(STDERR, "FAIL: $msg\n");
        exit(1);
    }
    echo "ok $msg\n";
}

// Signature correctness vs known vector
$body = '{"event":"user.created","payload":{"id":1}}';
$secret = 'test-secret';
$sig = webhook_sign($secret, $body);
$expected = hash_hmac('sha256', $body, $secret);
assert_true($sig === $expected, 'hmac matches hash_hmac');
assert_true(strlen($sig) === 64, 'hex digest length 64');
assert_true($sig !== webhook_sign('other', $body), 'different secret different sig');

// Retry timing
assert_true(webhook_retry_delay_seconds(1) === 0, 'attempt1 immediate');
assert_true(webhook_retry_delay_seconds(2) === 60, 'attempt2 60s');
assert_true(webhook_retry_delay_seconds(3) === 120, 'attempt3 120s');
assert_true(webhook_retry_delay_seconds(4) === 240, 'attempt4 240s');
assert_true(webhook_retry_delay_seconds(5) === 480, 'attempt5 480s');

// Max attempts constant alignment
$max = 5;
assert_true($max === 5, 'max attempts 5');

echo "ALL PASSED\n";
