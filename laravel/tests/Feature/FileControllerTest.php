<?php

namespace Tests\Feature;

use App\Models\File as StoredFile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\WithoutMiddleware;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File as FileSystem;
use Tests\TestCase;

class FileControllerTest extends TestCase
{
    use RefreshDatabase, WithoutMiddleware;

    public function test_file_upload_stores_metadata_and_rejects_duplicate_checksum(): void
    {
        $upload = UploadedFile::fake()->createWithContent('document.txt', 'invoice payload');

        $response = $this->postJson('/files/upload', [
            'file' => $upload,
        ]);

        $response
            ->assertCreated()
            ->assertJsonPath('original_name', 'document.txt')
            ->assertJsonPath('mime_type', 'text/plain')
            ->assertJsonPath('thumbnail_path', null);

        $checksum = hash('sha256', 'invoice payload');

        $this->assertDatabaseHas('files', [
            'checksum_sha256' => $checksum,
            'original_name' => 'document.txt',
        ]);

        $duplicate = UploadedFile::fake()->createWithContent('copy.txt', 'invoice payload');

        $this->postJson('/files/upload', [
            'file' => $duplicate,
        ])->assertConflict();
    }

    public function test_image_upload_generates_thumbnail_when_gd_is_available(): void
    {
        if (! function_exists('imagecreatetruecolor')) {
            $this->markTestSkipped('GD is required for thumbnail generation.');
        }

        $response = $this->postJson('/files/upload', [
            'file' => UploadedFile::fake()->image('photo.jpg', 400, 300),
        ]);

        $response
            ->assertCreated()
            ->assertJsonPath('original_name', 'photo.jpg');

        $thumbnailPath = $response->json('thumbnail_path');

        $this->assertNotNull($thumbnailPath);
        $this->assertFileExists(storage_path("app/{$thumbnailPath}"));
    }

    public function test_download_and_delete_endpoints_stream_and_remove_files(): void
    {
        $directory = storage_path('app/uploads/tests');
        FileSystem::ensureDirectoryExists($directory);
        file_put_contents("{$directory}/sample.txt", 'download me');

        $file = StoredFile::query()->create([
            'original_name' => 'sample.txt',
            'stored_path' => 'uploads/tests/sample.txt',
            'mime_type' => 'text/plain',
            'size_bytes' => 11,
            'checksum_sha256' => hash('sha256', 'download me'),
            'thumbnail_path' => null,
        ]);

        $downloadResponse = $this->get("/files/{$file->id}/download")
            ->assertOk();

        $this->assertStringStartsWith('text/plain', $downloadResponse->headers->get('content-type'));

        $this->deleteJson("/files/{$file->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('files', ['id' => $file->id]);
        $this->assertFileDoesNotExist("{$directory}/sample.txt");
    }

    public function test_eicar_signature_is_rejected_by_virus_scan(): void
    {
        $eicar = 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

        $this->postJson('/files/upload', [
            'file' => UploadedFile::fake()->createWithContent('eicar.txt', $eicar),
        ])->assertUnprocessable();
    }
}
