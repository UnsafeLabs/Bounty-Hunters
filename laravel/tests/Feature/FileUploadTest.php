<?php

namespace Tests\Feature;

use App\Models\File;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File as FileSystem;
use Tests\TestCase;

class FileUploadTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        FileSystem::deleteDirectory(storage_path('app/uploads'));
        FileSystem::deleteDirectory(storage_path('app/thumbnails'));

        parent::tearDown();
    }

    public function test_upload_stores_metadata_and_rejects_duplicate_checksum(): void
    {
        $upload = UploadedFile::fake()->createWithContent('report.txt', 'quarterly results');

        $response = $this->post('/files/upload', ['file' => $upload]);

        $response->assertCreated()
            ->assertJsonPath('data.original_name', 'report.txt')
            ->assertJsonPath('data.mime_type', 'text/plain')
            ->assertJsonPath('data.thumbnail_path', null);

        $file = File::query()->firstOrFail();

        $this->assertSame(hash('sha256', 'quarterly results'), $file->checksum_sha256);
        $this->assertFileExists(storage_path('app/'.$file->stored_path));

        $duplicate = UploadedFile::fake()->createWithContent('copy.txt', 'quarterly results');

        $this->post('/files/upload', ['file' => $duplicate])
            ->assertConflict()
            ->assertJsonPath('message', 'Duplicate file checksum.');
    }

    public function test_image_upload_generates_thumbnail(): void
    {
        if (! function_exists('imagecreatetruecolor')) {
            $this->markTestSkipped('GD extension is required for thumbnail generation.');
        }

        $response = $this->post('/files/upload', [
            'file' => UploadedFile::fake()->image('avatar.png', 640, 360),
        ]);

        $response->assertCreated();

        $file = File::query()->firstOrFail();

        $this->assertNotNull($file->thumbnail_path);
        $this->assertFileExists(storage_path('app/'.$file->thumbnail_path));

        [$width, $height] = getimagesize(storage_path('app/'.$file->thumbnail_path));

        $this->assertSame([200, 200], [$width, $height]);
    }

    public function test_download_delete_and_paginated_listing(): void
    {
        $storedPath = 'uploads/2026/06/13/manual.txt';
        FileSystem::ensureDirectoryExists(dirname(storage_path('app/'.$storedPath)));
        file_put_contents(storage_path('app/'.$storedPath), 'download me');

        $file = File::create([
            'original_name' => 'manual.txt',
            'stored_path' => $storedPath,
            'mime_type' => 'text/plain',
            'size_bytes' => strlen('download me'),
            'checksum_sha256' => hash('sha256', 'download me'),
        ]);

        for ($i = 0; $i < 24; $i++) {
            File::create([
                'original_name' => "extra-$i.txt",
                'stored_path' => "uploads/2026/06/13/extra-$i.txt",
                'mime_type' => 'text/plain',
                'size_bytes' => 1,
                'checksum_sha256' => hash('sha256', "extra-$i"),
            ]);
        }

        $this->get('/files')
            ->assertOk()
            ->assertJsonPath('per_page', 20);

        $this->get("/files/{$file->id}/download")
            ->assertOk()
            ->assertHeader('content-type', 'text/plain; charset=UTF-8');

        $this->delete("/files/{$file->id}")
            ->assertOk()
            ->assertJsonPath('message', 'File deleted.');

        $this->assertFileDoesNotExist(storage_path('app/'.$storedPath));
        $this->assertDatabaseMissing('files', ['id' => $file->id]);
    }

    public function test_eicar_signature_is_rejected(): void
    {
        $upload = UploadedFile::fake()->createWithContent(
            'eicar.txt',
            'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
        );

        $this->post('/files/upload', ['file' => $upload])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Uploaded file failed virus scan.');

        $this->assertDatabaseCount('files', 0);
    }
}
