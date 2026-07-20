<?php
$root = dirname(__DIR__, 2);
$web = file_get_contents($root.'/routes/web.php');
assert(strpos($web, 'throttle:web') !== false);
assert(strpos($web, 'debug/rate-limit') !== false);
$prov = file_get_contents($root.'/app/Providers/AppServiceProvider.php');
assert(strpos($prov, 'RateLimiter::for') !== false);
$sess = file_get_contents($root.'/config/session.php');
assert(strpos($sess, 'fallback') !== false);
echo "ALL PASSED\n";
