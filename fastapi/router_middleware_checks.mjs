import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./fastapi/routing.py", import.meta.url), "utf8");
const tests = readFileSync(new URL("./tests/test_router_middleware.py", import.meta.url), "utf8");
const metadata = JSON.parse(readFileSync(new URL("./fastapi/.provenance.json", import.meta.url), "utf8"));

assert.match(source, /from starlette\.middleware import Middleware/);
assert.match(source, /from starlette\.middleware\.base import BaseHTTPMiddleware/);
assert.match(source, /def _normalize_router_middleware/);
assert.match(source, /def _wrap_with_router_middleware/);
assert.match(source, /middleware: Annotated\[/);
assert.match(source, /self\.middleware: list\[Middleware\]/);
assert.match(source, /def add_middleware/);
assert.match(source, /Middleware\(BaseHTTPMiddleware, dispatch=middleware_class\)/);
assert.match(source, /route_middleware: Sequence\[Middleware\] \| None = None/);
assert.match(source, /route\.router_middleware = current_middleware/);
assert.match(source, /route\.app = _wrap_with_router_middleware\(route\.app, current_middleware\)/);
assert.match(source, /getattr\(route, "router_middleware", router\.middleware\)/);
assert.match(tests, /test_router_middleware_isolated_to_router_routes/);
assert.match(tests, /test_router_middleware_order_follows_addition_order/);
assert.match(tests, /test_include_router_preserves_router_middleware/);
assert.match(tests, /test_add_middleware_accepts_simple_callable_middleware/);
assert.equal(metadata.agent_name, "Codex GPT-5");
assert.ok(!metadata.config_snapshot.includes("You are"), "metadata must not leak private prompts");

console.log("fastapi router middleware checks passed");
