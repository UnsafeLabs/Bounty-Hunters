<?php

namespace Tests\Feature;

use App\Models\File as StoredFile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class FileUploadTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
    }

    public function test_image_upload_stores_metadata_checksum_and_thumbnail(): void
    {
        $upload = $this->imageUpload('photo.png');
        $checksum = hash_file('sha256', $upload->getRealPath());

        $response = $this->post('/files/upload', ['file' => $upload])
            ->assertCreated();

        $file = StoredFile::query()->firstOrFail();

        $response->assertJsonPath('id', $file->id);
        $this->assertSame('photo.png', $file->original_name);
        $this->assertSame('image/png', $file->mime_type);
        $this->assertSame($checksum, $file->checksum_sha256);
        $this->assertNotNull($file->thumbnail_path);
        Storage::disk('local')->assertExists($file->stored_path);
        Storage::disk('local')->assertExists($file->thumbnail_path);

        [$width, $height] = getimagesize(Storage::disk('local')->path($file->thumbnail_path));
        $this->assertSame([200, 200], [$width, $height]);
    }

    public function test_duplicate_checksum_is_rejected_and_non_image_has_no_thumbnail(): void
    {
        $this->post('/files/upload', ['file' => $this->textUpload('note.txt', 'same-content')])
            ->assertCreated()
            ->assertJsonPath('thumbnail_path', null);

        $this->post('/files/upload', ['file' => $this->textUpload('copy.txt', 'same-content')])
            ->assertConflict()
            ->assertJsonPath('message', 'Duplicate file checksum');

        $this->assertSame(1, StoredFile::query()->count());
    }

    public function test_virus_signature_is_rejected(): void
    {
        $this->post('/files/upload', [
            'file' => $this->textUpload('eicar.txt', 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
        ])->assertUnprocessable()
            ->assertJsonPath('message', 'File failed virus scan');
    }

    public function test_download_streams_file_with_content_type(): void
    {
        $this->post('/files/upload', ['file' => $this->textUpload('note.txt', 'download me')])
            ->assertCreated();
        $file = StoredFile::query()->firstOrFail();

        $response = $this->get("/files/{$file->id}/download")
            ->assertOk()
            ->assertHeader('Content-Type', 'text/plain; charset=UTF-8');

        $this->assertSame('download me', $response->streamedContent());
    }

    public function test_delete_removes_file_thumbnail_and_database_record(): void
    {
        $this->post('/files/upload', ['file' => $this->imageUpload('delete.png')])
            ->assertCreated();
        $file = StoredFile::query()->firstOrFail();

        $this->delete("/files/{$file->id}")->assertNoContent();

        Storage::disk('local')->assertMissing($file->stored_path);
        Storage::disk('local')->assertMissing($file->thumbnail_path);
        $this->assertDatabaseMissing('files', ['id' => $file->id]);
    }

    public function test_list_endpoint_paginates_twenty_files_per_page(): void
    {
        for ($i = 0; $i < 25; $i++) {
            StoredFile::query()->create([
                'original_name' => "file-{$i}.txt",
                'stored_path' => "uploads/test/file-{$i}.txt",
                'mime_type' => 'text/plain',
                'size_bytes' => 10,
                'checksum_sha256' => hash('sha256', "file-{$i}"),
            ]);
        }

        $this->get('/files')
            ->assertOk()
            ->assertJsonCount(20, 'data')
            ->assertJsonPath('per_page', 20)
            ->assertJsonPath('total', 25);
    }

    private function textUpload(string $name, string $content): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'upload-');
        file_put_contents($path, $content);

        return new UploadedFile($path, $name, 'text/plain', null, true);
    }

    private function imageUpload(string $name): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'upload-').'.png';
        $image = imagecreatetruecolor(300, 300);
        imagefilledrectangle($image, 0, 0, 300, 300, imagecolorallocate($image, 20, 120, 180));
        imagepng($image, $path);
        imagedestroy($image);

        return new UploadedFile($path, $name, 'image/png', null, true);
    }
}
