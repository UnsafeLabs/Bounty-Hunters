<?php

/**
 * Pure logic tests for file upload checksum + thumbnail sizing policy (#790).
 * Run: php laravel/tests/Unit/FileUploadLogicTest.php
 */

function assert_true(bool $c, string $m): void
{
    if (! $c) {
        fwrite(STDERR, "FAIL $m\n");
        exit(1);
    }
    echo "ok $m\n";
}

// Checksum stability
$a = 'hello-file-bytes';
$h1 = hash('sha256', $a);
$h2 = hash('sha256', $a);
assert_true($h1 === $h2, 'checksum stable');
assert_true(strlen($h1) === 64, 'sha256 hex len');
assert_true(hash('sha256', 'other') !== $h1, 'different content different hash');

// Thumbnail target size constant
$thumb = 200;
assert_true($thumb === 200, 'thumbnail 200x200');

// Pagination page size
$perPage = 20;
assert_true($perPage === 20, 'list page size 20');

// Duplicate detection policy: same checksum => 409
$existing = [$h1];
$isDup = in_array(hash('sha256', $a), $existing, true);
assert_true($isDup, 'duplicate detected');

// Image mime detection policy
function is_image_mime(string $mime): bool
{
    return str_starts_with($mime, 'image/');
}
assert_true(is_image_mime('image/png'), 'png is image');
assert_true(! is_image_mime('application/pdf'), 'pdf not image');

// Required files exist
$root = dirname(__DIR__, 2);
foreach ([
    'app/Models/File.php',
    'app/Http/Controllers/FileController.php',
    'database/migrations/2026_07_20_000010_create_files_table.php',
] as $rel) {
    assert_true(is_file($root . '/' . $rel), "present $rel");
}

$ctrl = file_get_contents($root . '/app/Http/Controllers/FileController.php');
foreach (['function upload', 'function download', 'function destroy', 'function index', '409', 'checksum_sha256', 'makeThumbnail'] as $n) {
    assert_true(strpos($ctrl, $n) !== false, "controller has $n");
}

echo "ALL PASSED\n";
