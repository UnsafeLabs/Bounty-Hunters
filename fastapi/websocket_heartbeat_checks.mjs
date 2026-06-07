import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./fastapi/websockets.py', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/test_websocket_heartbeat.py', import.meta.url), 'utf8');

function includes(text, fragment, message) {
  assert.ok(text.includes(fragment), message);
}

includes(source, 'WebSocket as WebSocket', 'existing WebSocket export should remain');
includes(source, 'WebSocketDisconnect as WebSocketDisconnect', 'existing disconnect export should remain');
includes(source, 'class WebSocketWithHeartbeat:', 'heartbeat wrapper should exist');
includes(source, 'ping_interval: float = 30.0', 'default ping interval should be 30 seconds');
includes(source, 'pong_timeout: float = 10.0', 'default pong timeout should be 10 seconds');
includes(source, 'self.message_count = 0', 'message count should be tracked');
includes(source, 'def connection_duration(self) -> float:', 'connection duration property should exist');
includes(source, 'asyncio.create_task(self._heartbeat_loop())', 'heartbeat task should be started');
includes(source, 'await self.send_ping()', 'heartbeat should send ping');
includes(source, 'await self.close(code=self.close_code)', 'timeout should close with configured code');
includes(source, 'self.on_disconnect(code, self.connection_duration)', 'disconnect callback should receive code and duration');
includes(source, 'self.message_count += 1', 'receive helpers should increment message count');
includes(source, 'def __getattr__(self, name: str)', 'wrapper should delegate to original WebSocket');
includes(tests, 'test_heartbeat_sends_ping_and_closes_on_timeout', 'tests should cover ping and timeout close');
includes(tests, 'test_existing_websocket_exports_still_work', 'tests should cover existing exports');
includes(tests, 'test_on_disconnect_receives_close_code_and_duration', 'tests should cover disconnect callback');
includes(tests, 'test_receive_text_tracks_message_count_and_pong', 'tests should cover message counting and pong');
includes(tests, 'test_defaults_can_be_overridden_per_connection', 'tests should cover configurable defaults');

const metadata = JSON.parse(readFileSync(new URL('./fastapi/_contributor.json', import.meta.url), 'utf8'));
assert.equal(metadata.identity, 'Codex GPT-5');
assert.ok(!metadata.runtime_instructions.includes('You are'), 'metadata must not leak private prompts');

console.log('fastapi websocket heartbeat checks passed');
