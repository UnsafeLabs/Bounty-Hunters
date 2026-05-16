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

    protected function setUp(): void
    {
        parent::setUp();

        FileSystem::deleteDirectory(storage_path('app/uploads'));
        FileSystem::deleteDirectory(storage_path('app/thumbnails'));
    }

    protected function tearDown(): void
    {
        FileSystem::deleteDirectory(storage_path('app/uploads'));
        FileSystem::deleteDirectory(storage_path('app/thumbnails'));

        parent::tearDown();
    }

    public function test_file_upload_stores_file_and_metadata(): void
    {
        $contents = 'quarterly report';

        $response = $this->post('/files/upload', [
            'file' => UploadedFile::fake()->createWithContent('report.txt', $contents),
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.original_name', 'report.txt')
            ->assertJsonPath('data.mime_type', 'text/plain')
            ->assertJsonPath('data.size_bytes', strlen($contents))
            ->assertJsonPath('data.checksum_sha256', hash('sha256', $contents))
            ->assertJsonPath('data.thumbnail_path', null);

        $file = File::query()->firstOrFail();

        $this->assertStringStartsWith('uploads/'.now()->format('Y/m/d').'/', $file->stored_path);
        $this->assertFileExists(storage_path("app/{$file->stored_path}"));
    }

    public function test_duplicate_checksum_is_rejected(): void
    {
        $this->post('/files/upload', [
            'file' => UploadedFile::fake()->createWithContent('first.txt', 'same file body'),
        ])->assertCreated();

        $this->post('/files/upload', [
            'file' => UploadedFile::fake()->createWithContent('second.txt', 'same file body'),
        ])->assertConflict()
            ->assertJsonPath('message', 'A file with the same checksum already exists.');

        $this->assertSame(1, File::query()->count());
    }

    public function test_image_upload_generates_200_by_200_thumbnail(): void
    {
        if (! function_exists('imagecreatefromstring')) {
            $this->markTestSkipped('GD is required for thumbnail generation.');
        }

        $response = $this->post('/files/upload', [
            'file' => UploadedFile::fake()->image('photo.jpg', 640, 480),
        ]);

        $response->assertCreated();

        $file = File::query()->firstOrFail();

        $this->assertNotNull($file->thumbnail_path);
        $this->assertStringStartsWith('thumbnails/'.now()->format('Y/m/d').'/', $file->thumbnail_path);
        $this->assertFileExists(storage_path("app/{$file->thumbnail_path}"));
        $this->assertSame([200, 200], array_slice(getimagesize(storage_path("app/{$file->thumbnail_path}")), 0, 2));
    }

    public function test_download_streams_file_with_content_type(): void
    {
        $contents = 'download me';

        $upload = $this->post('/files/upload', [
            'file' => UploadedFile::fake()->createWithContent('download.txt', $contents),
        ]);

        $id = $upload->json('data.id');

        $response = $this->get("/files/{$id}/download");

        $response->assertOk()
            ->assertHeader('content-type', 'text/plain; charset=UTF-8');
        $this->assertSame($contents, $response->streamedContent());
    }

    public function test_delete_removes_file_thumbnail_and_database_record(): void
    {
        if (! function_exists('imagecreatefromstring')) {
            $this->markTestSkipped('GD is required for thumbnail generation.');
        }

        $upload = $this->post('/files/upload', [
            'file' => UploadedFile::fake()->image('photo.png', 300, 300),
        ]);

        $file = File::query()->findOrFail($upload->json('data.id'));
        $storedPath = storage_path("app/{$file->stored_path}");
        $thumbnailPath = storage_path("app/{$file->thumbnail_path}");

        $this->assertFileExists($storedPath);
        $this->assertFileExists($thumbnailPath);

        $this->delete("/files/{$file->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('files', ['id' => $file->id]);
        $this->assertFileDoesNotExist($storedPath);
        $this->assertFileDoesNotExist($thumbnailPath);
    }

    public function test_list_endpoint_paginates_twenty_files_per_page(): void
    {
        foreach (range(1, 25) as $index) {
            $this->post('/files/upload', [
                'file' => UploadedFile::fake()->createWithContent("file-{$index}.txt", "contents {$index}"),
            ])->assertCreated();
        }

        $response = $this->get('/files');

        $response->assertOk()
            ->assertJsonPath('per_page', 20)
            ->assertJsonPath('total', 25)
            ->assertJsonCount(20, 'data');
    }
}
