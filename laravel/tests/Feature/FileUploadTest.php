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
