import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const controller = readFileSync(new URL('./app/Http/Controllers/AuthController.php', import.meta.url), 'utf8');
const routes = readFileSync(new URL('./routes/api.php', import.meta.url), 'utf8');
const user = readFileSync(new URL('./app/Models/User.php', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('./bootstrap/app.php', import.meta.url), 'utf8');
const composer = JSON.parse(readFileSync(new URL('./composer.json', import.meta.url), 'utf8'));
const tests = readFileSync(new URL('./tests/Feature/ApiAuthenticationTest.php', import.meta.url), 'utf8');
const metadata = JSON.parse(readFileSync(new URL('./.generation_meta.json', import.meta.url), 'utf8'));

assert.equal(composer.require['laravel/sanctum'], '^4.2');
assert.match(bootstrap, /api:\s*__DIR__\.'\/\.\.\/routes\/api\.php'/);
assert.match(user, /use Laravel\\Sanctum\\HasApiTokens;/);
assert.match(user, /use HasApiTokens, HasFactory, Notifiable;/);
assert.match(routes, /Route::post\('\/register'/);
assert.match(routes, /Route::post\('\/login'/);
assert.match(routes, /Route::post\('\/logout'.*auth:sanctum/s);
assert.match(controller, /public function register\(Request \$request\): JsonResponse/);
assert.match(controller, /'password' => \['required', 'string', 'min:8', 'confirmed'\]/);
assert.match(controller, /unique:users,email/);
assert.match(controller, /createToken\('api-token'\)->plainTextToken/);
assert.match(controller, /'message' => 'The provided credentials are incorrect\.'/);
assert.match(controller, /currentAccessToken\(\)\?->delete\(\)/);
assert.match(tests, /postJson\('\/api\/register'/);
assert.match(tests, /postJson\('\/api\/login'/);
assert.match(tests, /postJson\('\/api\/logout'/);
assert.equal(metadata.agent, 'Codex GPT-5');
assert.ok(!metadata.initial_directives.includes('You are'), 'metadata must not leak private prompts');

console.log('laravel api auth checks passed');
