import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const controller = readFileSync(new URL('./app/Http/Controllers/FileController.php', import.meta.url), 'utf8');
const model = readFileSync(new URL('./app/Models/File.php', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./database/migrations/2026_06_06_000003_create_files_table.php', import.meta.url), 'utf8');
const routes = readFileSync(new URL('./routes/web.php', import.meta.url), 'utf8');
const tests = readFileSync(new URL('./tests/Feature/FileUploadTest.php', import.meta.url), 'utf8');

function includes(source, fragment, message) {
  assert.ok(source.includes(fragment), message);
}

function matches(source, pattern, message) {
  assert.ok(pattern.test(source), message);
}

includes(model, 'class File extends Model', 'File model should exist');
for (const field of ['original_name', 'stored_path', 'mime_type', 'size_bytes', 'checksum_sha256', 'uploaded_by', 'thumbnail_path']) {
  includes(model, `'${field}'`, `File model should allow ${field}`);
  includes(migration, field, `files migration should define ${field}`);
}
includes(migration, "char('checksum_sha256', 64)->unique()", 'checksum should be stored uniquely');
includes(migration, "foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete()", 'uploaded_by should be nullable user FK');
includes(controller, "hash_file('sha256'", 'upload should compute SHA-256 from file contents');
includes(controller, "where('checksum_sha256', $checksum)->exists()", 'upload should detect duplicate checksums');
includes(controller, '], 409)', 'duplicate uploads should return 409 Conflict');
includes(controller, 'uploads/{$dateFolder}', 'uploads should be organized by date folders');
includes(controller, 'thumbnails/\'.now()->format(\'Y/m/d\')', 'thumbnails should be organized by date folders');
matches(controller, /imagecopyresampled\([\s\S]*?200,[\s\S]*?200,/, 'image thumbnails should be generated at 200x200');
includes(controller, "'thumbnail_path' => null", 'non-image uploads should default to null thumbnail path');
includes(controller, "Storage::download(", 'download endpoint should stream files through storage');
includes(controller, "['Content-Type' => $file->mime_type]", 'download should set Content-Type');
includes(controller, 'Storage::delete($file->stored_path);', 'delete should remove stored file');
includes(controller, 'Storage::delete($file->thumbnail_path);', 'delete should remove thumbnail');
includes(controller, 'paginate(20)', 'list endpoint should paginate at 20 items per page');
includes(routes, "Route::post('/files/upload'", 'upload route should exist');
includes(routes, "Route::get('/files/{file}/download'", 'download route should exist');
includes(routes, "Route::delete('/files/{file}'", 'delete route should exist');
includes(routes, "Route::get('/files'", 'list route should exist');
includes(tests, 'test_duplicate_checksum_is_rejected', 'tests should cover duplicate rejection');
includes(tests, "assertJsonPath('per_page', 20)", 'tests should cover pagination size');

const metadata = JSON.parse(readFileSync(new URL('./app/Http/Controllers/.generation_meta.json', import.meta.url), 'utf8'));
assert.equal(metadata.agent, 'Codex GPT-5');
assert.ok(!metadata.initial_directives.includes('You are'), 'metadata must not leak private prompts');

console.log('laravel file upload checks passed');
