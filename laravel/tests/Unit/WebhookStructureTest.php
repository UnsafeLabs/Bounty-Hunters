<?php

/**
 * Structural acceptance checks for webhook files (issue #754).
 */

$root = dirname(__DIR__, 2);
$required = [
    'app/Models/Webhook.php',
    'app/Models/WebhookDelivery.php',
    'app/Services/WebhookDispatcher.php',
    'app/Jobs/DispatchWebhookJob.php',
    'app/Http/Controllers/WebhookController.php',
    'database/migrations/2026_07_20_000001_create_webhooks_table.php',
    'database/migrations/2026_07_20_000002_create_webhook_deliveries_table.php',
];

foreach ($required as $rel) {
    $path = $root . '/' . $rel;
    if (! is_file($path)) {
        fwrite(STDERR, "MISSING $rel\n");
        exit(1);
    }
    echo "ok present $rel\n";
}

$dispatcher = file_get_contents($root . '/app/Services/WebhookDispatcher.php');
foreach (['hash_hmac', 'sha256', 'X-Webhook-Signature', 'MAX_ATTEMPTS', 'retryDelaySeconds'] as $needle) {
    if (strpos($dispatcher, $needle) === false) {
        fwrite(STDERR, "Dispatcher missing $needle\n");
        exit(1);
    }
    echo "ok dispatcher has $needle\n";
}

$job = file_get_contents($root . '/app/Jobs/DispatchWebhookJob.php');
if (strpos($job, 'tries = 5') === false && strpos($job, 'tries=5') === false) {
    // allow public int $tries = 5
    if (! preg_match('/\$tries\s*=\s*5/', $job)) {
        fwrite(STDERR, "Job missing tries=5\n");
        exit(1);
    }
}
echo "ok job tries=5\n";

$controller = file_get_contents($root . '/app/Http/Controllers/WebhookController.php');
foreach (['function index', 'function store', 'function show', 'function update', 'function destroy'] as $m) {
    if (strpos($controller, $m) === false) {
        fwrite(STDERR, "Controller missing $m\n");
        exit(1);
    }
    echo "ok controller $m\n";
}

echo "ALL STRUCTURE PASSED\n";
