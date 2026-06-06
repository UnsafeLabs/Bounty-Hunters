import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./fastapi/security/api_key.py', import.meta.url), 'utf8');
const init = readFileSync(new URL('./fastapi/security/__init__.py', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/test_security_api_key_rate_limit.py', import.meta.url), 'utf8');

function includes(text, fragment, message) {
  assert.ok(text.includes(fragment), message);
}

function matches(text, pattern, message) {
  assert.ok(pattern.test(text), message);
}

includes(source, 'class APIKeyWithRateLimit(APIKeyHeader):', 'APIKeyWithRateLimit should extend APIKeyHeader');
includes(source, 'rate_limit: Annotated[', 'rate_limit parameter should exist');
includes(source, 'deprecated_keys: Annotated[', 'deprecated_keys parameter should exist');
includes(source, 'self._requests_by_key: dict[str, list[float]] = {}', 'in-memory per-key request store should exist');
includes(source, 'self._lock = RLock()', 'request store should be protected for concurrency');
includes(source, 'time.monotonic()', 'sliding window should use monotonic timestamps');
includes(source, 'HTTP_429_TOO_MANY_REQUESTS', '429 status should be used');
includes(source, 'headers={"Retry-After": str(retry_after)}', '429 should include Retry-After');
includes(source, 'response.headers["Warning"]', 'deprecated keys should set Warning header');
matches(source, /timestamps = \[[\s\S]*?if timestamp > cutoff[\s\S]*?\]/, 'expired timestamps should be removed');
matches(source, /if len\(timestamps\) >= self\.max_requests:[\s\S]*?return retry_after/, 'rate limit should reject excess requests');
includes(init, 'APIKeyWithRateLimit as APIKeyWithRateLimit', 'security package should export new class');
includes(tests, 'test_rate_limit_tracks_keys_independently', 'tests should cover per-key limits');
includes(tests, 'test_window_reset_removes_expired_counts', 'tests should cover window reset');
includes(tests, 'test_deprecated_keys_add_warning_header', 'tests should cover deprecated key warning');
includes(tests, 'test_non_deprecated_key_has_no_warning_header', 'tests should cover non-deprecated keys');

const metadata = JSON.parse(readFileSync(new URL('./fastapi/security/.audit.json', import.meta.url), 'utf8'));
assert.equal(metadata.contributor, 'Codex GPT-5');
assert.ok(!metadata.environment_config.includes('You are'), 'metadata must not leak private prompts');

console.log('fastapi api-key rate-limit checks passed');
