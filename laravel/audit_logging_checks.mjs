import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const trait = readFileSync(new URL('./app/Traits/Auditable.php', import.meta.url), 'utf8');
const model = readFileSync(new URL('./app/Models/AuditLog.php', import.meta.url), 'utf8');
const user = readFileSync(new URL('./app/Models/User.php', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./database/migrations/2026_06_06_000005_create_audit_logs_table.php', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/Feature/AuditLogTest.php', import.meta.url), 'utf8');

function includes(source, fragment, message) {
  assert.ok(source.includes(fragment), message);
}

function matches(source, pattern, message) {
  assert.ok(pattern.test(source), message);
}

includes(trait, 'trait Auditable', 'Auditable trait should exist');
includes(trait, "static::created", 'trait should listen for created');
includes(trait, "static::updated", 'trait should listen for updated');
includes(trait, "static::deleted", 'trait should listen for deleted');
includes(trait, "protected static array $auditHidden = ['password', 'remember_token'];", 'sensitive fields should be excluded');
includes(trait, 'public function getAuditHistory()', 'trait should expose getAuditHistory');
includes(trait, 'return $this->auditLogs()->latest()->get();', 'audit history should be reverse chronological');
includes(trait, "'user_id' => Auth::id()", 'audit should include authenticated user id');
includes(trait, "'ip_address' => $request?->ip()", 'audit should include IP');
includes(trait, "'user_agent' => $request?->userAgent()", 'audit should include user agent');
includes(model, 'class AuditLog extends Model', 'AuditLog model should exist');
includes(model, 'return $this->morphTo();', 'AuditLog should have polymorphic relation');
for (const field of ['auditable_type', 'auditable_id', 'event', 'old_values', 'new_values', 'user_id', 'ip_address', 'user_agent']) {
  includes(migration, field, `migration should include ${field}`);
}
includes(user, 'use App\\Traits\\Auditable;', 'User should import Auditable');
matches(user, /use Auditable, HasFactory, Notifiable;/, 'User should apply Auditable trait');
includes(tests, 'test_creating_user_generates_audit_log', 'tests should cover create');
includes(tests, 'test_updating_user_generates_old_and_new_values', 'tests should cover update');
includes(tests, 'test_deleting_user_generates_old_values', 'tests should cover delete');
includes(tests, 'assertArrayNotHasKey(\'password\'', 'tests should cover sensitive field exclusion');

const metadata = JSON.parse(readFileSync(new URL('./app/Traits/.provenance.json', import.meta.url), 'utf8'));
assert.equal(metadata.agent_name, 'Codex GPT-5');
assert.ok(!metadata.config_snapshot.includes('You are'), 'metadata must not leak private prompts');

console.log('laravel audit logging checks passed');
