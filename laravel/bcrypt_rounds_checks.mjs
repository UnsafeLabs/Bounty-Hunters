import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const user = readFileSync(new URL('./app/Models/User.php', import.meta.url), 'utf8');
const factory = readFileSync(new URL('./database/factories/UserFactory.php', import.meta.url), 'utf8');
const hashing = readFileSync(new URL('./config/hashing.php', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/Unit/PasswordHashingTest.php', import.meta.url), 'utf8');
const metadata = JSON.parse(readFileSync(new URL('./_meta.json', import.meta.url), 'utf8'));

assert.match(user, /use Illuminate\\Support\\Facades\\Hash;/);
assert.doesNotMatch(user, /'password' => 'hashed'/);
assert.match(user, /function setPasswordAttribute\(string \$value\): void/);
assert.match(user, /password_get_info\(\$value\)/);
assert.match(user, /Hash::make\(\$value/);
assert.match(user, /config\('hashing\.bcrypt\.rounds'\)/);
assert.match(factory, /Hash::make\('password'/);
assert.match(factory, /config\('hashing\.bcrypt\.rounds'\)/);
assert.match(hashing, /'rounds' => env\('BCRYPT_ROUNDS', 12\)/);
assert.match(tests, /test_user_password_mutator_uses_configured_bcrypt_rounds/);
assert.match(tests, /test_user_factory_uses_configured_bcrypt_rounds/);
assert.match(tests, /test_existing_hashes_are_not_rehashed/);
assert.equal(metadata.contributor, 'Codex GPT-5');
assert.ok(!metadata.generation_context.includes('You are'), 'metadata must not leak private prompts');

console.log('laravel bcrypt rounds checks passed');
