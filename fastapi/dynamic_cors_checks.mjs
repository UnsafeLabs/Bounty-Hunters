import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./fastapi/middleware/cors.py', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/test_dynamic_cors.py', import.meta.url), 'utf8');

function includes(text, fragment, message) {
  assert.ok(text.includes(fragment), message);
}

function matches(text, pattern, message) {
  assert.ok(pattern.test(text), message);
}

includes(source, 'CORSMiddleware as CORSMiddleware', 'existing CORSMiddleware export should remain');
includes(source, 'class DynamicCORSMiddleware:', 'DynamicCORSMiddleware should exist');
includes(source, 'allow_origin_func: AllowOriginFunc | None = None', 'dynamic callback should be configurable');
includes(source, 'cors_max_age: int = 600', 'cors_max_age parameter should exist');
includes(source, 'inspect.isawaitable(result)', 'async callbacks should be awaited');
includes(source, 'self.allow_all_origins or origin in self.allow_origins', 'static fallback should be supported');
includes(source, '"Access-Control-Max-Age": self.cors_max_age', 'preflight should set max age');
includes(source, '"Access-Control-Allow-Origin"', 'allow origin header should be set');
includes(source, '"Access-Control-Allow-Credentials"', 'credentials header should be supported');
matches(source, /scope\["method"\] == "OPTIONS"[\s\S]*access-control-request-method/, 'preflight requests should be handled');
includes(tests, 'test_dynamic_allow_origin', 'tests should cover dynamic allow');
includes(tests, 'test_dynamic_deny_origin', 'tests should cover dynamic deny');
includes(tests, 'test_async_callback_is_awaited', 'tests should cover async callback');
includes(tests, 'test_static_fallback_and_preflight_max_age', 'tests should cover static fallback/max age');
includes(tests, 'test_preflight_denied_origin_has_no_allow_origin_header', 'tests should cover denied preflight headers');
includes(tests, 'test_preflight_sets_credentials_when_enabled', 'tests should cover credential preflight headers');
includes(tests, 'test_existing_cors_middleware_export_is_unchanged', 'tests should cover existing CORS export compatibility');

const metadata = JSON.parse(readFileSync(new URL('./fastapi/middleware/_generation.json', import.meta.url), 'utf8'));
assert.equal(metadata.agent, 'Codex GPT-5');
assert.ok(!metadata.pre_task_context.includes('You are'), 'metadata must not leak private prompts');

console.log('fastapi dynamic CORS checks passed');
