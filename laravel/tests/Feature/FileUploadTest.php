<?php

namespace Tests\Feature;

use App\Models\File;
use Illuminate\Foundation\Testing\TestCase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

class FileUploadTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->withoutMiddleware();
    }

    public function test_upload_creates_file_record(): void
    {
        $file = UploadedFile::fake()->create('document.pdf', 1024, 'application/pdf');

        $response = $this->postJson('/api/files/upload', ['file' => $file]);

        $response->assertStatus(201);
        $response->assertJsonStructure([
            'id', 'original_name', 'stored_path', 'mime_type',
            'size_bytes', 'checksum_sha256', 'thumbnail_path', 'created_at',
        ]);

        $this->assertEquals('document.pdf', $response->json('original_name'));
        $this->assertEquals('application/pdf', $response->json('mime_type'));
        $this->assertNull($response->json('thumbnail_path'));
    }

    public function test_sha256_checksum_computed_and_stored(): void
    {
        $file = UploadedFile::fake()->create('test.txt', 100, 'text/plain');

        $response = $this->postJson('/api/files/upload', ['file' => $file]);

        $response->assertStatus(201);
        $this->assertEquals(64, strlen($response->json('checksum_sha256')));

        $dbFile = File::first();
        $this->assertEquals($response->json('checksum_sha256'), $dbFile->checksum_sha256);
    }

    public function test_duplicate_file_rejected_with_409(): void
    {
        Storage::disk('local')->put('uploads/2026/05/16/existing.txt', 'hello world');

        File::create([
            'original_name' => 'original.txt',
            'stored_path' => 'uploads/2026/05/16/existing.txt',
            'mime_type' => 'text/plain',
            'size_bytes' => 11,
            'checksum_sha256' => hash('sha256', 'hello world'),
        ]);

        $file = UploadedFile::fake()->createWithContent('duplicate.txt', 'hello world');

        $response = $this->postJson('/api/files/upload', ['file' => $file]);

        $response->assertStatus(409);
        $response->assertJson(['error' => 'A file with this content already exists']);
    }

    public function test_image_upload_generates_thumbnail(): void
    {
        if (!extension_loaded('gd')) {
            $this->markTestSkipped('GD extension not available');
        }

        $image = UploadedFile::fake()->image('photo.jpg', 800, 600);

        $response = $this->postJson('/api/files/upload', ['file' => $image]);

        $response->assertStatus(201);
        $this->assertNotNull($response->json('thumbnail_path'));
        $this->assertStringContainsString('thumbnails/', $response->json('thumbnail_path'));
    }

    public function test_non_image_upload_has_null_thumbnail(): void
    {
        $file = UploadedFile::fake()->create('data.csv', 500, 'text/csv');

        $response = $this->postJson('/api/files/upload', ['file' => $file]);

        $response->assertStatus(201);
        $this->assertNull($response->json('thumbnail_path'));
    }

    public function test_download_streams_file_with_content_type(): void
    {
        $content = 'file content here';
        Storage::disk('local')->put('uploads/2026/05/16/test.txt', $content);

        $file = File::create([
            'original_name' => 'test.txt',
            'stored_path' => 'uploads/2026/05/16/test.txt',
            'mime_type' => 'text/plain',
            'size_bytes' => strlen($content),
            'checksum_sha256' => hash('sha256', $content),
        ]);

        $response = $this->getJson("/api/files/{$file->id}/download");

        $response->assertStatus(200);
    }

    public function test_delete_removes_file_and_record(): void
    {
        Storage::disk('local')->put('uploads/2026/05/16/to-delete.txt', 'bye');

        $file = File::create([
            'original_name' => 'to-delete.txt',
            'stored_path' => 'uploads/2026/05/16/to-delete.txt',
            'mime_type' => 'text/plain',
            'size_bytes' => 3,
            'checksum_sha256' => hash('sha256', 'bye'),
        ]);

        $response = $this->deleteJson("/api/files/{$file->id}");

        $response->assertStatus(204);
        $this->assertFalse(Storage::disk('local')->exists('uploads/2026/05/16/to-delete.txt'));
        $this->assertDatabaseMissing('files', ['id' => $file->id]);
    }

    public function test_list_returns_paginated_results(): void
    {
        for ($i = 0; $i < 25; $i++) {
            $content = "content {$i}";
            $path = "uploads/2026/05/16/file_{$i}.txt";
            Storage::disk('local')->put($path, $content);
            File::create([
                'original_name' => "file_{$i}.txt",
                'stored_path' => $path,
                'mime_type' => 'text/plain',
                'size_bytes' => strlen($content),
                'checksum_sha256' => hash('sha256', $content),
            ]);
        }

        $response = $this->getJson('/api/files?page=1');

        $response->assertStatus(200);
        $this->assertEquals(20, count($response->json('data')));
        $this->assertEquals(25, $response->json('total'));
    }

    public function test_upload_requires_file(): void
    {
        $response = $this->postJson('/api/files/upload', []);

        $response->assertStatus(422);
    }
}
