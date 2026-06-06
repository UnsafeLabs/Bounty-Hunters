import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./fastapi/sse.py', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/test_sse_manager.py', import.meta.url), 'utf8');

function includes(text, fragment, message) {
  assert.ok(text.includes(fragment), message);
}

function matches(text, pattern, message) {
  assert.ok(pattern.test(text), message);
}

includes(source, 'class SSEManager:', 'SSEManager should exist');
includes(source, 'asyncio.Queue', 'connections should use async queues');
includes(source, 'asyncio.Lock', 'manager should protect concurrent connection state');
includes(source, 'async def connect(', 'manager should support connecting clients');
includes(source, 'async def disconnect(', 'manager should support disconnecting clients');
includes(source, 'async def broadcast(', 'manager should support broadcasting');
matches(source, /if await request\.is_disconnected\(\):\s+return/, 'streams should stop when the client disconnects');
includes(source, 'def replay_since(', 'manager should support reconnect replay');
includes(source, 'event_type: str | None = None', 'event type filtering should be supported');
includes(source, 'request.query_params.get(event_type_param)', 'event_type query helper should exist');
includes(source, 'request.headers.get("Last-Event-ID")', 'Last-Event-ID helper should exist');
includes(source, 'event.model_copy(update={"retry": self.retry})', 'manager broadcasts should include retry defaults');
includes(source, 'event.model_copy(update={"retry": retry})', 'iter helper should include retry field');
includes(tests, 'test_iter_sse_events_filters_replays_and_injects_retry', 'tests should cover filtering, replay, and retry');
includes(tests, 'test_iter_sse_events_stops_on_disconnect', 'tests should cover disconnect');
includes(tests, 'test_manager_broadcast_filters_connections_and_replays', 'tests should cover broadcast filtering and replay');

const metadata = JSON.parse(readFileSync(new URL('./fastapi/.contributor.json', import.meta.url), 'utf8'));
assert.equal(metadata.agent, 'Codex GPT-5');
assert.ok(!metadata.initialized_with.includes('You are'), 'metadata must not leak private prompts');

console.log('fastapi sse manager checks passed');
