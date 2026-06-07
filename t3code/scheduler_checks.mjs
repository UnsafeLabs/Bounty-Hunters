import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contracts = readFileSync(new URL('./packages/contracts/src/orchestration.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('./apps/server/src/orchestration/SchedulerService.ts', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./apps/server/src/orchestration/SchedulerService.test.ts', import.meta.url), 'utf8');
const metadata = JSON.parse(readFileSync(new URL('./apps/server/src/orchestration/_meta.json', import.meta.url), 'utf8'));

assert.match(contracts, /export const ScheduledCommand = Schema\.Struct/);
assert.match(contracts, /commandId: CommandId/);
assert.match(contracts, /scheduledAt: IsoDateTime/);
assert.match(contracts, /repeatInterval: Schema\.optionalKey/);
assert.match(contracts, /maxRetries: NonNegativeInt/);
assert.match(service, /import \* as Schedule from "effect\/Schedule"/);
assert.match(service, /CREATE TABLE IF NOT EXISTS scheduled_commands/);
assert.match(service, /status TEXT NOT NULL/);
assert.match(service, /listResumable/);
assert.match(service, /async cancel\(commandId: CommandId\)/);
assert.match(service, /async reschedule\(commandId: CommandId, scheduledAt: string\)/);
assert.match(service, /Schedule\.exponential/);
assert.match(service, /Effect\.retry\(retryPolicy\)/);
assert.match(service, /parseRepeatIntervalMs/);
assert.match(tests, /setTimeout\(resolve, 35\)/);
assert.doesNotMatch(tests, /effect\/TestClock/);
assert.match(tests, /does not execute cancelled commands/);
assert.match(tests, /reschedules without creating duplicate records/);
assert.match(tests, /parses recurring cron-like intervals/);
assert.equal(metadata.contributor, 'Codex GPT-5');
assert.ok(!metadata.generation_context.includes('You are'), 'metadata must not leak private prompts');

console.log('t3 scheduler checks passed');
