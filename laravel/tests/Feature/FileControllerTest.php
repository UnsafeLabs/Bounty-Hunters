<?php

namespace Tests\Feature;

use App\Models\File as StoredFile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class FileControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_upload_stores_file_and_metadata(): void
    {
        Storage::fake('uploads');

        $upload = UploadedFile::fake()->createWithContent('report.txt', 'Quarterly results');
        $checksum = hash('sha256', 'Quarterly results');

        $this->post('/files/upload', ['file' => $upload])
            ->assertCreated()
            ->assertJsonPath('data.original_name', 'report.txt')
            ->assertJsonPath('data.checksum_sha256', $checksum);

        $file = StoredFile::query()->firstOrFail();

        Storage::disk('uploads')->assertExists($file->stored_path);
        $this->assertSame('report.txt', $file->original_name);
        $this->assertSame($checksum, $file->checksum_sha256);
        $this->assertNull($file->thumbnail_path);
    }

    public function test_duplicate_checksum_is_rejected(): void
    {
        Storage::fake('uploads');

        $this->post('/files/upload', [
            'file' => UploadedFile::fake()->createWithContent('first.txt', 'same bytes'),
        ])->assertCreated();

        $this->post('/files/upload', [
            'file' => UploadedFile::fake()->createWithContent('second.txt', 'same bytes'),
        ])
            ->assertConflict()
            ->assertJsonPath('checksum_sha256', hash('sha256', 'same bytes'));

        $this->assertSame(1, StoredFile::query()->count());
    }

    public function test_image_upload_generates_200_by_200_thumbnail(): void
    {
        Storage::fake('uploads');

        $this->post('/files/upload', [
            'file' => UploadedFile::fake()->image('photo.jpg', 400, 300),
        ])->assertCreated();

        $file = StoredFile::query()->firstOrFail();

        $this->assertNotNull($file->thumbnail_path);
        Storage::disk('uploads')->assertExists($file->thumbnail_path);

        $size = getimagesizefromstring(Storage::disk('uploads')->get($file->thumbnail_path));

        $this->assertSame(200, $size[0]);
        $this->assertSame(200, $size[1]);
    }

    public function test_download_streams_file_with_original_name_and_content_type(): void
    {
        Storage::fake('uploads');

        $this->post('/files/upload', [
            'file' => UploadedFile::fake()->createWithContent('manual.txt', 'download me'),
        ])->assertCreated();

        $file = StoredFile::query()->firstOrFail();

        $this->get("/files/{$file->id}/download")
            ->assertOk()
            ->assertHeaderContains('Content-Type', $file->mime_type)
            ->assertDownload('manual.txt');
    }

    public function test_delete_removes_file_thumbnail_and_database_record(): void
    {
        Storage::fake('uploads');

        $this->post('/files/upload', [
            'file' => UploadedFile::fake()->image('photo.png', 300, 300),
        ])->assertCreated();

        $file = StoredFile::query()->firstOrFail();

        $this->delete("/files/{$file->id}")
            ->assertNoContent();

        Storage::disk('uploads')->assertMissing($file->stored_path);
        Storage::disk('uploads')->assertMissing($file->thumbnail_path);
        $this->assertDatabaseMissing('files', ['id' => $file->id]);
    }

    public function test_list_endpoint_paginates_20_files_per_page(): void
    {
        Storage::fake('uploads');

        for ($index = 1; $index <= 21; $index++) {
            StoredFile::query()->create([
                'original_name' => "file-{$index}.txt",
                'stored_path' => "uploads/file-{$index}.txt",
                'mime_type' => 'text/plain',
                'size_bytes' => 12,
                'checksum_sha256' => hash('sha256', "file-{$index}"),
                'thumbnail_path' => null,
            ]);
        }

        $this->get('/files')
            ->assertOk()
            ->assertJsonPath('per_page', 20)
            ->assertJsonCount(20, 'data');
    }
}
