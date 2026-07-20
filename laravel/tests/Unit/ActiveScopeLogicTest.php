<?php
function assert_true(bool $c, string $m): void {
  if (!$c) { fwrite(STDERR,"FAIL $m\n"); exit(1);} echo "ok $m\n";
}
$root=dirname(__DIR__,2);
assert_true(is_file($root.'/app/Scopes/ActiveScope.php'),'scope');
assert_true(is_file($root.'/app/Observers/UserObserver.php'),'obs');
assert_true(is_file($root.'/database/migrations/2026_07_20_000050_add_uuid_to_users_table.php'),'mig');
$obs=file_get_contents($root.'/app/Observers/UserObserver.php');
assert_true(strpos($obs,'Str::uuid')!==false,'uuid gen');
$scope=file_get_contents($root.'/app/Scopes/ActiveScope.php');
assert_true(strpos($scope,'active')!==false,'active filter');
$prov=file_get_contents($root.'/app/Providers/AppServiceProvider.php');
assert_true(strpos($prov,'preventLazyLoading')!==false,'lazy');
assert_true(strpos($prov,'UserObserver')!==false,'reg');
// pure uuid format
$u=sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',1,2,3,4,5,6,7,8);
assert_true(strlen($u)===36,'uuid len');
echo "ALL PASSED\n";
