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

    public function test_upload_file()
    {
        Storage::fake("local");
        $user = \App\Models\User::factory()->create(["active" => 1]);
        $this->actingAs($user);

        $file = UploadedFile::fake()->create("test.pdf", 100);
        $response = $this->post("/files/upload", ["file" => $file]);

        $response->assertStatus(201);
        $response->assertJsonStructure(["id", "original_name", "checksum_sha256"]);
    }

    public function test_duplicate_file_rejected()
    {
        Storage::fake("local");
        $user = \App\Models\User::factory()->create(["active" => 1]);
        $this->actingAs($user);

        $file = UploadedFile::fake()->create("doc.pdf", 200);
        $this->post("/files/upload", ["file" => $file]);
        $response = $this->post("/files/upload", ["file" => $file]);

        $response->assertStatus(409);
    }

    public function test_list_files()
    {
        $user = \App\Models\User::factory()->create(["active" => 1]);
        $this->actingAs($user);
        $response = $this->get("/files");
        $response->assertStatus(200);
    }

    public function test_file_has_checksum()
    {
        Storage::fake("local");
        $user = \App\Models\User::factory()->create(["active" => 1]);
        $this->actingAs($user);

        $file = UploadedFile::fake()->create("test.txt", 50);
        $response = $this->post("/files/upload", ["file" => $file]);
        $data = $response->json();
        $this->assertNotNull($data["checksum_sha256"]);
        $this->assertEquals(64, strlen($data["checksum_sha256"]));
    }
}
