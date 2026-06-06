import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./fastapi/testclient.py', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/test_fastapi_testclient.py', import.meta.url), 'utf8');

function includes(text, fragment, message) {
  assert.ok(text.includes(fragment), message);
}

includes(source, 'TestClient as TestClient', 'existing TestClient import should remain');
includes(source, 'class FastAPITestClient(TestClient):', 'FastAPITestClient should extend TestClient');
includes(source, 'def authenticate(self, token: str)', 'Bearer auth helper should exist');
includes(source, 'self.headers["Authorization"] = f"Bearer {token}"', 'Bearer helper should set header');
includes(source, 'def authenticate_basic(', 'Basic auth helper should exist');
includes(source, 'base64.b64encode', 'Basic auth should base64 encode credentials');
includes(source, 'def reset_auth(self)', 'reset_auth should exist');
includes(source, 'self.headers.pop("Authorization", None)', 'reset_auth should clear auth state');
includes(source, 'def ws_connect(', 'ws_connect helper should exist');
includes(source, 'self.websocket_connect(', 'ws_connect should call websocket_connect');
includes(source, 'subprotocols=subprotocols', 'ws_connect should pass subprotocols');
includes(source, 'def assert_status(', 'assert_status helper should exist');
includes(source, 'Expected status', 'assert_status should raise helpful message');
includes(tests, 'test_existing_testclient_import_still_works', 'tests should cover existing TestClient behavior');
includes(tests, 'test_authenticate_sets_and_replaces_bearer_header', 'tests should cover Bearer auth replacement');
includes(tests, 'test_authenticate_basic_sets_encoded_header', 'tests should cover Basic auth');
includes(tests, 'test_reset_auth_clears_authentication_state', 'tests should cover reset_auth');
includes(tests, 'test_ws_connect_supports_headers_and_subprotocols', 'tests should cover WebSocket helper');
includes(tests, 'test_assert_status_returns_response_and_raises_helpfully', 'tests should cover assert_status');

const metadata = JSON.parse(readFileSync(new URL('./fastapi/.audit.json', import.meta.url), 'utf8'));
assert.equal(metadata.contributor, 'Codex GPT-5');
assert.ok(!metadata.environment_config.includes('You are'), 'metadata must not leak private prompts');

console.log('fastapi testclient helper checks passed');
