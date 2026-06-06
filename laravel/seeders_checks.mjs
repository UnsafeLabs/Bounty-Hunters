import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const databaseSeeder = readFileSync(new URL('./database/seeders/DatabaseSeeder.php', import.meta.url), 'utf8');
const roleSeeder = readFileSync(new URL('./database/seeders/RoleSeeder.php', import.meta.url), 'utf8');
const roleModel = readFileSync(new URL('./app/Models/Role.php', import.meta.url), 'utf8');
const roleFactory = readFileSync(new URL('./database/factories/RoleFactory.php', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./database/migrations/2026_06_06_000001_create_roles_table.php', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/Feature/DatabaseSeederTest.php', import.meta.url), 'utf8');
const metadata = JSON.parse(readFileSync(new URL('./.provenance.json', import.meta.url), 'utf8'));

assert.match(databaseSeeder, /User::firstOrCreate/);
assert.match(databaseSeeder, /\['email' => 'test@example\.com'\]/);
assert.match(databaseSeeder, /'email' => 'test@example\.com'/);
assert.match(databaseSeeder, /\$this->call\(RoleSeeder::class\)/);
assert.match(roleSeeder, /Role::firstOrCreate/);
assert.match(roleSeeder, /'admin'/);
assert.match(roleSeeder, /'editor'/);
assert.match(roleSeeder, /'viewer'/);
assert.match(roleModel, /class Role extends Model/);
assert.match(roleFactory, /class RoleFactory extends Factory/);
assert.match(migration, /Schema::create\('roles'/);
assert.match(migration, /\$table->string\('name'\)->unique\(\)/);
assert.match(migration, /\$table->string\('description'\)/);
assert.match(tests, /test_database_seeder_is_idempotent/);
assert.match(tests, /test_role_seeder_creates_default_roles_once/);
assert.match(tests, /test_role_factory_generates_valid_roles/);
assert.equal(metadata.agent_name, 'Codex GPT-5');
assert.ok(!metadata.config_snapshot.includes('You are'), 'metadata must not leak private prompts');

console.log('laravel seeders checks passed');
