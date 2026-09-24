<?php

namespace Tests\Feature;

use App\Models\File;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class FileUploadTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('uploads');
        Storage::fake('thumbnails');
    }

    private function upload(UploadedFile $file): TestResponse
    {
        return $this->post('/files/upload', ['file' => $file]);
    }

    public function test_non_image_upload_stores_the_file_and_its_metadata(): void
    {
        $response = $this->upload(UploadedFile::fake()->createWithContent('notes.txt', 'hello world'));

        $response->assertCreated()
            ->assertJsonPath('original_name', 'notes.txt')
            ->assertJsonPath('mime_type', 'text/plain')
            ->assertJsonPath('size_bytes', strlen('hello world'))
            ->assertJsonPath('checksum_sha256', hash('sha256', 'hello world'))
            ->assertJsonPath('thumbnail_path', null);

        $this->assertDatabaseHas('files', [
            'original_name' => 'notes.txt',
            'checksum_sha256' => hash('sha256', 'hello world'),
            'thumbnail_path' => null,
        ]);

        Storage::disk('uploads')->assertExists($response->json('stored_path'));
    }

    public function test_image_upload_generates_a_200x200_thumbnail(): void
    {
        $response = $this->upload(UploadedFile::fake()->image('photo.jpg', 640, 480));

        $response->assertCreated();

        $thumbnailPath = $response->json('thumbnail_path');

        $this->assertNotNull($thumbnailPath);
        Storage::disk('thumbnails')->assertExists($thumbnailPath);

        $size = getimagesize(Storage::disk('thumbnails')->path($thumbnailPath));

        $this->assertSame([200, 200], [$size[0], $size[1]]);
    }

    public function test_duplicate_checksum_is_rejected_with_conflict(): void
    {
        $this->upload(UploadedFile::fake()->createWithContent('first.txt', 'identical bytes'))->assertCreated();

        $duplicate = $this->upload(UploadedFile::fake()->createWithContent('second.txt', 'identical bytes'));

        $duplicate->assertStatus(409)
            ->assertJsonPath('checksum_sha256', hash('sha256', 'identical bytes'));

        $this->assertSame(1, File::query()->count());
    }

    public function test_download_streams_the_file_with_its_content_type(): void
    {
        $id = $this->upload(UploadedFile::fake()->createWithContent('report.txt', 'download me'))
            ->assertCreated()
            ->json('id');

        $download = $this->get("/files/{$id}/download");

        $download->assertOk();
        $download->assertHeader('content-type', 'text/plain; charset=UTF-8');
        $this->assertSame('download me', $download->streamedContent());
    }

    public function test_download_returns_404_when_the_stored_file_is_gone(): void
    {
        $response = $this->upload(UploadedFile::fake()->createWithContent('gone.txt', 'vanishing'))
            ->assertCreated();

        Storage::disk('uploads')->delete($response->json('stored_path'));

        $this->get("/files/{$response->json('id')}/download")->assertNotFound();
    }

    public function test_delete_removes_the_file_the_thumbnail_and_the_record(): void
    {
        $response = $this->upload(UploadedFile::fake()->image('photo.jpg', 320, 200))->assertCreated();

        $id = $response->json('id');
        $storedPath = $response->json('stored_path');
        $thumbnailPath = $response->json('thumbnail_path');

        $this->deleteJson("/files/{$id}")->assertNoContent();

        $this->assertDatabaseMissing('files', ['id' => $id]);
        Storage::disk('uploads')->assertMissing($storedPath);
        Storage::disk('thumbnails')->assertMissing($thumbnailPath);
    }

    public function test_list_endpoint_paginates_twenty_items_per_page(): void
    {
        foreach (range(1, 25) as $index) {
            File::create([
                'original_name' => "file-{$index}.txt",
                'stored_path' => "2026/09/23/file-{$index}.txt",
                'mime_type' => 'text/plain',
                'size_bytes' => 10,
                'checksum_sha256' => hash('sha256', "file-{$index}"),
            ]);
        }

        $this->getJson('/files')
            ->assertOk()
            ->assertJsonCount(20, 'data')
            ->assertJsonPath('per_page', 20)
            ->assertJsonPath('total', 25);

        $this->getJson('/files?page=2')
            ->assertOk()
            ->assertJsonCount(5, 'data');
    }

    public function test_upload_requires_a_file(): void
    {
        $this->postJson('/files/upload', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors('file');
    }
}
