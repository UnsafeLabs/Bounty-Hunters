import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function read(path) {
  const fullPath = join(process.cwd(), path);
  assert.ok(existsSync(fullPath), `${path} must exist`);
  return readFileSync(fullPath, "utf8");
}

function expectSource(source, pattern, message) {
  assert.match(source, pattern, message);
}

const composer = read("composer.json");
expectSource(composer, /"laravel\/sanctum"\s*:/, "composer must require Sanctum");

const bootstrap = read("bootstrap/app.php");
expectSource(
  bootstrap,
  /api:\s*__DIR__\s*\.\s*['"]\/\.\.\/routes\/api\.php['"]/,
  "bootstrap routing must load routes/api.php",
);

const user = read("app/Models/User.php");
expectSource(user, /Laravel\\Sanctum\\HasApiTokens/, "User must import HasApiTokens");
expectSource(user, /use\s+HasApiTokens,\s*HasFactory,\s*Notifiable\s*;/, "User must use HasApiTokens");

const routes = read("routes/api.php");
expectSource(routes, /Route::post\(['"]\/?register['"]/, "register route must exist");
expectSource(routes, /Route::post\(['"]\/?login['"]/, "login route must exist");
expectSource(routes, /Route::post\(['"]\/?logout['"][\s\S]*auth:sanctum/, "logout route must use auth:sanctum");

const controller = read("app/Http/Controllers/AuthController.php");
for (const method of ["register", "login", "logout"]) {
  expectSource(
    controller,
    new RegExp(`function\\s+${method}\\s*\\(`),
    `AuthController must implement ${method}`,
  );
}
expectSource(controller, /createToken\(['"]api-token['"]\)/, "register/login must create Sanctum tokens");
expectSource(controller, /Password::min\(8\)/, "registration must require minimum 8 character passwords");
expectSource(controller, /unique:users,email/, "registration must require unique email");
expectSource(controller, /Hash::check/, "login must verify hashed passwords");
expectSource(controller, /Invalid credentials/, "invalid login must return a JSON error message");
expectSource(controller, /status:\s*201/, "registration must return HTTP 201");
expectSource(controller, /status:\s*401/, "invalid login must return HTTP 401");
expectSource(controller, /currentAccessToken\(\)\?->delete\(\)/, "logout must revoke the current access token");

const migration = read("database/migrations/0001_01_01_000003_create_personal_access_tokens_table.php");
expectSource(migration, /personal_access_tokens/, "Sanctum token table migration must exist");

const featureTest = read("tests/Feature/ApiAuthTest.php");
expectSource(featureTest, /test_register_returns_token/, "feature tests must cover registration");
expectSource(featureTest, /test_login_rejects_invalid_credentials/, "feature tests must cover invalid login");
expectSource(featureTest, /test_logout_revokes_current_token/, "feature tests must cover logout revocation");

const metadata = read("app/Http/Controllers/.generation_meta.json");
expectSource(metadata, /OpenAI Codex/, "generation metadata must identify the agent");

console.log("Laravel issue #752 checks passed");
