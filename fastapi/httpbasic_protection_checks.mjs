import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./fastapi/security/http.py', import.meta.url), 'utf8');
const exports = readFileSync(new URL('./fastapi/security/__init__.py', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/test_security_http_basic_with_protection.py', import.meta.url), 'utf8');
const metadata = JSON.parse(readFileSync(new URL('./fastapi/security/.generation_meta.json', import.meta.url), 'utf8'));

assert.match(source, /class HTTPBasicWithProtection\(HTTPBasic\):/);
assert.match(source, /max_attempts: int = 5/);
assert.match(source, /window_seconds: int = 300/);
assert.match(source, /self\._failed_attempts: dict\[str, list\[float\]\] = \{\}/);
assert.match(source, /HTTP_429_TOO_MANY_REQUESTS/);
assert.match(source, /"Retry-After": str\(retry_after\)/);
assert.match(source, /def record_failed_attempt\(self, request: Request\) -> None:/);
assert.match(source, /def reset_attempts\(self, request: Request\) -> None:/);
assert.match(source, /hmac\.compare_digest/);
assert.match(source, /hashlib\.sha256/);
assert.match(source, /CryptContext\(schemes=\["bcrypt"\]\)\.verify/);
assert.match(exports, /HTTPBasicWithProtection as HTTPBasicWithProtection/);
assert.match(tests, /test_failed_attempts_are_tracked_per_ip/);
assert.match(tests, /test_lockout_returns_429_with_retry_after_header/);
assert.match(tests, /test_successful_authentication_resets_attempts/);
assert.match(tests, /test_verify_password_uses_timing_safe_comparison_for_sha256_hash/);
assert.equal(metadata.agent, 'Codex GPT-5');
assert.ok(!metadata.initial_directives.includes('You are'), 'metadata must not leak private prompts');

console.log('fastapi httpbasic protection checks passed');
