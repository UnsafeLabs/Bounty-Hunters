<?php

namespace Tests\Feature;

use App\Models\File;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class FileUploadTest extends TestCase
{
    use RefreshDatabase;

    public function test_upload_stores_metadata_and_checksum(): void
    {
        Storage::fake('local');

        $response = $this->postJson('/files/upload', [
            'file' => UploadedFile::fake()->createWithContent('report.txt', 'hello world'),
        ]);

        $response->assertCreated();

        $file = File::query()->firstOrFail();
        $this->assertSame(hash('sha256', 'hello world'), $file->checksum_sha256);
        $this->assertNull($file->thumbnail_path);
        Storage::assertExists($file->stored_path);
    }

    public function test_duplicate_checksum_is_rejected(): void
    {
        Storage::fake('local');
        $payload = ['file' => UploadedFile::fake()->createWithContent('a.txt', 'same')];

        $this->postJson('/files/upload', $payload)->assertCreated();
        $this->postJson('/files/upload', [
            'file' => UploadedFile::fake()->createWithContent('b.txt', 'same'),
        ])->assertConflict();
    }

    public function test_download_streams_file_with_content_type(): void
    {
        Storage::fake('local');
        Storage::put('uploads/report.txt', 'download me');
        $file = File::query()->create([
            'original_name' => 'report.txt',
            'stored_path' => 'uploads/report.txt',
            'mime_type' => 'text/plain',
            'size_bytes' => 11,
            'checksum_sha256' => hash('sha256', 'download me'),
        ]);

        $response = $this->get("/files/{$file->id}/download");

        $response->assertOk();
        $response->assertHeader('Content-Type', 'text/plain');
    }

    public function test_delete_removes_file_thumbnail_and_record(): void
    {
        Storage::fake('local');
        Storage::put('uploads/image.jpg', 'image-bytes');
        Storage::put('thumbnails/image.jpg', 'thumb-bytes');
        $file = File::query()->create([
            'original_name' => 'image.jpg',
            'stored_path' => 'uploads/image.jpg',
            'mime_type' => 'image/jpeg',
            'size_bytes' => 11,
            'checksum_sha256' => str_repeat('b', 64),
            'thumbnail_path' => 'thumbnails/image.jpg',
        ]);

        $this->delete("/files/{$file->id}")->assertNoContent();

        Storage::assertMissing('uploads/image.jpg');
        Storage::assertMissing('thumbnails/image.jpg');
        $this->assertDatabaseMissing('files', ['id' => $file->id]);
    }

    public function test_image_upload_generates_thumbnail_when_gd_is_available(): void
    {
        if (! function_exists('imagecreatetruecolor')) {
            $this->markTestSkipped('GD is not available in this PHP runtime.');
        }

        Storage::fake('local');

        $this->postJson('/files/upload', [
            'file' => UploadedFile::fake()->image('avatar.jpg', 400, 400),
        ])->assertCreated();

        $file = File::query()->firstOrFail();
        $this->assertNotNull($file->thumbnail_path);
        Storage::assertExists($file->thumbnail_path);
    }

    public function test_list_uses_twenty_items_per_page(): void
    {
        File::query()->create([
            'original_name' => 'one.txt',
            'stored_path' => 'uploads/one.txt',
            'mime_type' => 'text/plain',
            'size_bytes' => 3,
            'checksum_sha256' => str_repeat('a', 64),
        ]);

        $this->getJson('/files')->assertOk()->assertJsonPath('per_page', 20);
    }
}
