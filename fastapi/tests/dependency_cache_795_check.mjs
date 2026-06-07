import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const utils = read("fastapi/fastapi/dependencies/utils.py");
const tests = read("fastapi/tests/test_dependency_cache.py");
const meta = read("fastapi/_meta.json");

const checks = [
  [
    "dependency cache is request-scoped",
    utils.includes('request.scope.setdefault("fastapi_dependency_cache", {})'),
  ],
  [
    "parameterless dependencies pass use_cache",
    /get_parameterless_sub_dependant[\s\S]*use_cache=depends\.use_cache/.test(utils),
  ],
  [
    "only cache-enabled dependencies write dependency_cache",
    /if sub_dependant\.use_cache and sub_dependant\.cache_key not in dependency_cache:[\s\S]*dependency_cache\[sub_dependant\.cache_key\] = solved/.test(utils),
  ],
  [
    "no-cache first then cached regression test exists",
    tests.includes("test_no_cache_dependency_does_not_seed_later_cached_dependency") &&
      tests.includes("/sub-counter-no-cache-first/"),
  ],
  [
    "parameterless no-cache regression test exists",
    tests.includes("test_parameterless_no_cache_dependency_does_not_seed_cache") &&
      tests.includes('/decorator-counter-no-cache/", dependencies=[Depends(dep_counter, use_cache=False)]'),
  ],
  [
    "async cache request-scope test exists",
    tests.includes("test_async_dependency_cache_is_request_scoped") &&
      tests.includes("/async-sub-counter/"),
  ],
  [
    "safe metadata is present",
    meta.includes("Codex GPT-5") && meta.includes("private system") && !meta.includes("<paste"),
  ],
];

const failures = checks.filter(([, ok]) => !ok);
if (failures.length > 0) {
  console.error("FastAPI issue 795 dependency cache checks failed:");
  for (const [name] of failures) console.error(`- ${name}`);
  process.exit(1);
}

console.log("FastAPI issue 795 dependency cache checks passed");
