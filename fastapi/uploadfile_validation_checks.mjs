import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./fastapi/datastructures.py', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/test_uploadfile_validation.py', import.meta.url), 'utf8');
const metadata = JSON.parse(readFileSync(new URL('./contributor_meta.json', import.meta.url), 'utf8'));

assert.match(source, /@dataclass\(frozen=True\)\nclass ValidationResult:/);
assert.match(source, /is_valid: bool/);
assert.match(source, /file_size: int \| None/);
assert.match(source, /content_type: str \| None/);
assert.match(source, /max_size: int \| None = None/);
assert.match(source, /allowed_content_types: list\[str\] \| tuple\[str, \.\.\.\] \| set\[str\] \| None = None/);
assert.match(source, /async def validate\(self\) -> ValidationResult:/);
assert.match(source, /HTTP_413_REQUEST_ENTITY_TOO_LARGE/);
assert.match(source, /HTTP_415_UNSUPPORTED_MEDIA_TYPE/);
assert.match(source, /self\.file\.seek\(0, 2\)/);
assert.match(source, /self\.file\.seek\(current_position\)/);
assert.match(tests, /test_upload_file_validate_returns_metadata/);
assert.match(tests, /test_upload_file_validate_raises_413_for_large_file/);
assert.match(tests, /test_upload_file_validate_raises_415_for_disallowed_content_type/);
assert.match(tests, /test_upload_file_validation_skips_unset_constraints/);
assert.match(tests, /test_upload_file_validate_preserves_file_position/);
assert.equal(metadata.name, 'Codex GPT-5');
assert.ok(!metadata.session_init.includes('You are'), 'metadata must not leak private prompts');

console.log('fastapi uploadfile validation checks passed');
