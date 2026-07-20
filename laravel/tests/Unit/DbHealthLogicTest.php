<?php
$root=dirname(__DIR__,2);
$c=file_get_contents($root.'/app/Http/Controllers/HealthController.php');
assert(strpos($c,'MAX_ATTEMPTS = 3')!==false);
assert(strpos($c,'500_000')!==false || strpos($c,'500000')!==false);
assert(strpos($c,'latency_ms')!==false);
assert(strpos($c,'503')!==false);
$r=file_get_contents($root.'/routes/web.php');
assert(strpos($r,'health/database')!==false);
echo "ALL PASSED\n";
