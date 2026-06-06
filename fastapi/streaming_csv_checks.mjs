import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./fastapi/responses.py', import.meta.url), 'utf8');
const exports = readFileSync(new URL('./fastapi/__init__.py', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/test_streaming_csv_response.py', import.meta.url), 'utf8');
const metadata = JSON.parse(readFileSync(new URL('./contributor_meta.json', import.meta.url), 'utf8'));

assert.match(source, /import csv/);
assert.match(source, /class StreamingCSVResponse\(StreamingResponse\):/);
assert.match(source, /media_type = "text\/csv"/);
assert.match(source, /rows: AsyncIterable\[CSVRow\] \| Iterable\[CSVRow\]/);
assert.match(source, /headers: Sequence\[str\] \| None = None/);
assert.match(source, /filename: str = "export\.csv"/);
assert.match(source, /delimiter: str = ","/);
assert.match(source, /Content-Disposition/);
assert.match(source, /async for row/);
assert.match(source, /csv\.writer\(buffer, delimiter=self\.delimiter, lineterminator="\\n"\)/);
assert.match(exports, /StreamingCSVResponse as StreamingCSVResponse/);
assert.match(tests, /test_streaming_csv_response_writes_headers_and_escapes_values/);
assert.match(tests, /contains ""quote""/);
assert.match(tests, /test_streaming_csv_response_supports_custom_delimiter/);
assert.match(tests, /test_streaming_csv_response_sets_content_headers/);
assert.match(tests, /test_streaming_csv_response_streams_without_eager_iteration/);
assert.equal(metadata.name, 'Codex GPT-5');
assert.ok(!metadata.session_init.includes('You are'), 'metadata must not leak private prompts');

console.log('fastapi streaming csv checks passed');
