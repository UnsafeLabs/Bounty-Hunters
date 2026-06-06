import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provider = readFileSync(new URL('./app/Providers/AppServiceProvider.php', import.meta.url), 'utf8');
const routes = readFileSync(new URL('./routes/web.php', import.meta.url), 'utf8');
const session = readFileSync(new URL('./config/session.php', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/Feature/WebRateLimitTest.php', import.meta.url), 'utf8');
const metadata = JSON.parse(readFileSync(new URL('./.contributor.json', import.meta.url), 'utf8'));

assert.match(provider, /RateLimiter::for\('web'/);
assert.match(provider, /Limit::perMinute\(60\)->by/);
assert.match(provider, /user:\'\.\$user->getAuthIdentifier\(\)/);
assert.match(provider, /'ip:'\.\$request->ip\(\)/);
assert.match(routes, /Route::middleware\('throttle:web'\)->group/);
assert.match(routes, /\/debug\/rate-limit/);
assert.match(routes, /x-ratelimit-limit/);
assert.match(routes, /X-RateLimit-Remaining/);
assert.match(session, /'fallback' => env\('SESSION_FALLBACK_DRIVER', 'file'\)/);
assert.match(tests, /assertTooManyRequests/);
assert.match(tests, /RateLimiter::limiter\('web'\)/);
assert.match(tests, /assertHeader\('X-RateLimit-Limit', '60'\)/);
assert.match(tests, /config\('session.fallback'\)/);
assert.equal(metadata.agent, 'Codex GPT-5');
assert.ok(!metadata.initialized_with.includes('You are'), 'metadata must not leak private prompts');

console.log('laravel rate limit session checks passed');
