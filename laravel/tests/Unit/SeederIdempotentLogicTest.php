<?php
// Pure logic: firstOrCreate semantics
function firstOrCreate(array $store, string $key, array $attrs): array {
    if (isset($store[$key])) return [$store, false];
    $store[$key] = $attrs;
    return [$store, true];
}
$store=[];
[$store,$c1]=firstOrCreate($store,'test@example.com',['name'=>'Test']);
[$store,$c2]=firstOrCreate($store,'test@example.com',['name'=>'Test']);
assert($c1===true && $c2===false);
$roles=[];
foreach(['admin','editor','viewer'] as $r){[$roles,$created]=firstOrCreate($roles,$r,['name'=>$r]);}
[$roles,$c3]=firstOrCreate($roles,'admin',['name'=>'admin']);
assert(count($roles)===3 && $c3===false);
echo "ALL PASSED\n";
