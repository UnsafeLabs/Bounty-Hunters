<?php
$cmd = file_get_contents(dirname(__DIR__,2).'/app/Console/Commands/FailedJobsSummaryCommand.php');
assert(strpos($cmd, 'queue:failed-summary') !== false);
$l = file_get_contents(dirname(__DIR__,2).'/app/Listeners/LogFailedJob.php');
assert(strpos($l, 'queue.job_failed') !== false);
// exception class parse
function exceptionClass(string $blob): string {
    if (preg_match('/^([A-Za-z0-9_\\\\]+)/', $blob, $m)) return $m[1];
    return 'Unknown';
}
assert(exceptionClass("RuntimeException: boom\nstack") === 'RuntimeException');
echo "ALL PASSED\n";
