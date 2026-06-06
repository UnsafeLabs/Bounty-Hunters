import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const user = readFileSync(new URL('./app/Models/User.php', import.meta.url), 'utf8');
const routes = readFileSync(new URL('./routes/web.php', import.meta.url), 'utf8');
const mail = readFileSync(new URL('./config/mail.php', import.meta.url), 'utf8');
const middleware = readFileSync(new URL('./app/Http/Middleware/EnsureEmailIsVerified.php', import.meta.url), 'utf8');
const notification = readFileSync(new URL('./app/Notifications/CustomVerifyEmail.php', import.meta.url), 'utf8');
const noticeView = readFileSync(new URL('./resources/views/auth/verify-email.blade.php', import.meta.url), 'utf8');
const emailView = readFileSync(new URL('./resources/views/emails/verify-email.blade.php', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/Feature/EmailVerificationFlowTest.php', import.meta.url), 'utf8');
const metadata = JSON.parse(readFileSync(new URL('./.audit.json', import.meta.url), 'utf8'));

assert.match(user, /implements MustVerifyEmailContract/);
assert.match(user, /sendEmailVerificationNotification/);
assert.match(user, /new CustomVerifyEmail\(\)/);
assert.match(routes, /\/email\/verify\/\{id\}\/\{hash\}/);
assert.match(routes, /EmailVerificationRequest/);
assert.match(routes, /throttle:1,1/);
assert.match(routes, /verification-link-sent/);
assert.match(mail, /'fallback_mailer' => env\('MAIL_FALLBACK_MAILER', 'log'\)/);
assert.match(mail, /'primary_with_fallback'/);
assert.match(mail, /'transport' => 'failover'/);
assert.match(middleware, /redirect\(\)->route\('verification.notice'\)/);
assert.match(notification, /extends VerifyEmail/);
assert.match(notification, /emails.verify-email/);
assert.match(noticeView, /route\('verification.send'\)/);
assert.match(emailView, /Verify email address/);
assert.match(tests, /temporarySignedRoute/);
assert.match(tests, /Notification::assertSentTo\(\$user, CustomVerifyEmail::class\)/);
assert.match(tests, /middleware\('verified.email'\)/);
assert.equal(metadata.contributor, 'Codex GPT-5');
assert.ok(!metadata.environment_config.includes('You are'), 'metadata must not leak private prompts');

console.log('laravel email verification checks passed');
