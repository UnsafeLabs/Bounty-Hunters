import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const model = readFileSync(new URL('./app/Models/NotificationPreference.php', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./database/migrations/2026_06_06_000004_create_notification_preferences_table.php', import.meta.url), 'utf8');
const controller = readFileSync(new URL('./app/Http/Controllers/NotificationPreferenceController.php', import.meta.url), 'utf8');
const router = readFileSync(new URL('./app/Services/NotificationRouter.php', import.meta.url), 'utf8');
const observer = readFileSync(new URL('./app/Observers/UserObserver.php', import.meta.url), 'utf8');
const provider = readFileSync(new URL('./app/Providers/AppServiceProvider.php', import.meta.url), 'utf8');
const routes = readFileSync(new URL('./routes/web.php', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/Feature/NotificationPreferenceTest.php', import.meta.url), 'utf8');

function includes(source, fragment, message) {
  assert.ok(source.includes(fragment), message);
}

function matches(source, pattern, message) {
  assert.ok(pattern.test(source), message);
}

includes(model, 'class NotificationPreference extends Model', 'preference model should exist');
for (const channel of ['mail', 'slack', 'database']) {
  includes(model, `'${channel}'`, `${channel} channel should be supported`);
}
for (const field of ['user_id', 'channel', 'event_type', 'enabled']) {
  includes(migration, field, `migration should include ${field}`);
}
includes(migration, "$table->unique(['user_id', 'channel', 'event_type']);", 'unique preference constraint should prevent duplicates');
includes(controller, 'public function index(Request $request): JsonResponse', 'index endpoint should exist');
includes(controller, 'public function update(Request $request, NotificationPreference $preference): JsonResponse', 'single update endpoint should exist');
includes(controller, 'public function bulkUpdate(Request $request): JsonResponse', 'bulk update endpoint should exist');
includes(controller, "'preferences.*.enabled' => ['required', 'boolean']", 'bulk update should validate enabled booleans');
includes(router, 'public function channelsFor(User $user, string $eventType): array', 'router should expose enabled channels');
matches(router, /where\('enabled', true\)[\s\S]*pluck\('channel'\)/, 'router should only select enabled channels');
includes(router, 'public function enabled(User $user, string $eventType, string $channel): bool', 'router should check individual channel state');
includes(observer, 'NotificationPreference::seedDefaultsFor($user);', 'observer should seed defaults for new users');
includes(provider, 'User::observe(UserObserver::class);', 'observer should be registered');
includes(routes, "Route::get('/notifications/preferences'", 'list route should exist');
includes(routes, "Route::put('/notifications/preferences/{preference}'", 'update route should exist');
includes(routes, "Route::post('/notifications/preferences/bulk'", 'bulk route should exist');
includes(tests, 'test_users_can_list_preferences', 'feature tests should cover listing');
includes(tests, 'test_individual_preference_can_be_toggled', 'feature tests should cover update');
includes(tests, 'test_bulk_update_toggles_multiple_preferences', 'feature tests should cover bulk update');
includes(tests, 'test_router_filters_disabled_channels', 'feature tests should cover router filtering');

const metadata = JSON.parse(readFileSync(new URL('./app/Models/_contributor.json', import.meta.url), 'utf8'));
assert.equal(metadata.identity, 'Codex GPT-5');
assert.ok(!metadata.runtime_instructions.includes('You are'), 'metadata must not leak private prompts');

console.log('laravel notification preference checks passed');
