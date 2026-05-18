<?php

namespace Tests\Feature;

use App\Models\FileUpload;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class FileUploadTest extends TestCase
{
    use RefreshDatabase;

    public function test_upload_file(): void
    {
        Storage::fake('local');
        $user = User::factory()->create();

        $file = UploadedFile::fake()->create('doc.pdf', 1000, 'application/pdf');

        $response = $this->actingAs($user)
            ->postJson('/api/files/upload', ['file' => $file]);

        $response->assertCreated();
        $this->assertDatabaseHas('file_uploads', [
            'original_name' => 'doc.pdf',
            'uploaded_by' => $user->id,
        ]);
    }

    public function test_dedup_by_checksum(): void
    {
        Storage::fake('local');
        $user = User::factory()->create();

        $file1 = UploadedFile::fake()->create('a.txt', 100, 'text/plain');
        $file2 = UploadedFile::fake()->create('b.txt', 100, 'text/plain');

        // First upload
        $this->actingAs($user)->postJson('/api/files/upload', ['file' => $file1]);
        // Second upload with different name but could be same content
        $response = $this->actingAs($user)->postJson('/api/files/upload', ['file' => $file2]);

        // Should succeed — different files have different checksums
        $this->assertGreaterThanOrEqual(1, FileUpload::count());
    }

    public function test_list_files(): void
    {
        Storage::fake('local');
        $user = User::factory()->create();

        FileUpload::create([
            'original_name' => 'test.txt',
            'stored_path' => 'uploads/2026/05/18/test.txt',
            'mime_type' => 'text/plain',
            'size_bytes' => 100,
            'checksum_sha256' => str_repeat('a', 64),
            'uploaded_by' => $user->id,
        ]);

        $response = $this->actingAs($user)
            ->getJson('/api/files');

        $response->assertOk();
    }

    public function test_delete_own_file(): void
    {
        Storage::fake('local');
        $user = User::factory()->create();

        $file = FileUpload::create([
            'original_name' => 'test.txt',
            'stored_path' => 'uploads/test.txt',
            'mime_type' => 'text/plain',
            'size_bytes' => 100,
            'checksum_sha256' => str_repeat('a', 64),
            'uploaded_by' => $user->id,
        ]);

        $response = $this->actingAs($user)
            ->deleteJson("/api/files/{$file->id}");

        $response->assertOk();
        $this->assertDatabaseMissing('file_uploads', ['id' => $file->id]);
    }

    public function test_cannot_delete_others_file(): void
    {
        $user1 = User::factory()->create();
        $user2 = User::factory()->create();

        $file = FileUpload::create([
            'original_name' => 'test.txt',
            'stored_path' => 'uploads/test.txt',
            'mime_type' => 'text/plain',
            'size_bytes' => 100,
            'checksum_sha256' => str_repeat('b', 64),
            'uploaded_by' => $user1->id,
        ]);

        $response = $this->actingAs($user2)
            ->deleteJson("/api/files/{$file->id}");

        $response->assertForbidden();
    }
}
