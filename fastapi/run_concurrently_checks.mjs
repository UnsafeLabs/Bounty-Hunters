import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./fastapi/concurrency.py', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/test_run_concurrently.py', import.meta.url), 'utf8');
const metadata = JSON.parse(readFileSync(new URL('./fastapi/_contributor.json', import.meta.url), 'utf8'));

assert.match(source, /import asyncio/);
assert.match(source, /class ConcurrencyError\(Exception, Generic\[_T\]\):/);
assert.match(source, /self\.failures = list\(failures\)/);
assert.match(source, /self\.partial_results = list\(partial_results or \[\]\)/);
assert.match(source, /async def run_concurrently/);
assert.match(source, /max_concurrency: int/);
assert.match(source, /timeout: float \| None = None/);
assert.match(source, /asyncio\.Semaphore\(max_concurrency\)/);
assert.match(source, /asyncio\.wait_for/);
assert.match(source, /task\.cancel\(\)/);
assert.match(tests, /test_run_concurrently_limits_concurrency_and_preserves_order/);
assert.match(tests, /test_run_concurrently_sequential_when_max_concurrency_is_one/);
assert.match(tests, /test_run_concurrently_collects_all_failures/);
assert.match(tests, /test_run_concurrently_timeout_cancels_remaining_and_keeps_partial_results/);
assert.match(tests, /test_run_concurrently_allows_concurrency_above_task_count/);
assert.equal(metadata.identity, 'Codex GPT-5');
assert.ok(!metadata.runtime_instructions.includes('You are'), 'metadata must not leak private prompts');

console.log('fastapi run_concurrently checks passed');
