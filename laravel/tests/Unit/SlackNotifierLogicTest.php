<?php
$root=dirname(__DIR__,2);
$s=file_get_contents($root.'/app/Services/SlackNotifier.php');
assert(strpos($s,'timeout(5)')!==false);
assert(strpos($s,'attempt < 2')!==false || strpos($s,'attempt++')!==false);
assert(strpos($s,'function send')!==false);
$c=file_get_contents($root.'/config/services.php');
assert(strpos($c,'webhook_url')!==false);
echo "ALL PASSED\n";
