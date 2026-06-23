<?php

namespace Tests\Feature;

use App\Models\File;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class FileControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_upload_stores_file_and_creates_record_with_metadata(): void
    {
        Storage::fake('uploads');

        $upload = UploadedFile::fake()->createWithContent('report.txt', 'hello world');

        $response = $this->postJson('/files/upload', ['file' => $upload]);

        $response->assertCreated()
            ->assertJsonPath('original_name', 'report.txt')
            ->assertJsonPath('mime_type', 'text/plain')
            ->assertJsonPath('thumbnail_path', null);

        $this->assertDatabaseCount('files', 1);

        $file = File::query()->firstOrFail();
        $this->assertSame(hash('sha256', 'hello world'), $file->checksum_sha256);
        $this->assertSame(strlen('hello world'), $file->size_bytes);
        Storage::disk('uploads')->assertExists($file->stored_path);
    }

    public function test_duplicate_checksum_is_rejected_with_conflict(): void
    {
        Storage::fake('uploads');

        $this->postJson('/files/upload', [
            'file' => UploadedFile::fake()->createWithContent('a.txt', 'identical'),
        ])->assertCreated();

        $this->postJson('/files/upload', [
            'file' => UploadedFile::fake()->createWithContent('b.txt', 'identical'),
        ])->assertStatus(409);

        $this->assertDatabaseCount('files', 1);
    }

    public function test_image_upload_generates_200x200_thumbnail(): void
    {
        Storage::fake('uploads');

        $upload = UploadedFile::fake()->image('photo.jpg', 640, 480);

        $response = $this->postJson('/files/upload', ['file' => $upload]);

        $response->assertCreated();

        $file = File::query()->firstOrFail();
        $this->assertNotNull($file->thumbnail_path);
        Storage::disk('uploads')->assertExists($file->thumbnail_path);

        $thumbnail = Storage::disk('uploads')->get($file->thumbnail_path);
        [$width, $height] = getimagesizefromstring($thumbnail);
        $this->assertSame(200, $width);
        $this->assertSame(200, $height);
    }

    public function test_download_streams_file_with_content_type_header(): void
    {
        Storage::fake('uploads');

        $this->postJson('/files/upload', [
            'file' => UploadedFile::fake()->createWithContent('note.txt', 'streamed body'),
        ])->assertCreated();

        $file = File::query()->firstOrFail();

        $response = $this->get("/files/{$file->id}/download");

        $response->assertOk();
        $response->assertHeader('content-type', 'text/plain');
        $this->assertSame('streamed body', $response->streamedContent());
    }

    public function test_delete_removes_file_from_disk_and_database(): void
    {
        Storage::fake('uploads');

        $this->postJson('/files/upload', [
            'file' => UploadedFile::fake()->createWithContent('gone.txt', 'bye'),
        ])->assertCreated();

        $file = File::query()->firstOrFail();
        Storage::disk('uploads')->assertExists($file->stored_path);

        $this->deleteJson("/files/{$file->id}")->assertOk();

        $this->assertDatabaseCount('files', 0);
        Storage::disk('uploads')->assertMissing($file->stored_path);
    }

    public function test_index_paginates_twenty_per_page(): void
    {
        Storage::fake('uploads');

        foreach (range(1, 25) as $i) {
            $this->postJson('/files/upload', [
                'file' => UploadedFile::fake()->createWithContent("file-{$i}.txt", "contents number {$i}"),
            ])->assertCreated();
        }

        $response = $this->getJson('/files');

        $response->assertOk()
            ->assertJsonPath('per_page', 20)
            ->assertJsonPath('total', 25)
            ->assertJsonCount(20, 'data');
    }
}
