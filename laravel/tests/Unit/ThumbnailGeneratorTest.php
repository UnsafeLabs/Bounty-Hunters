<?php

namespace Tests\Unit;

use App\Services\ThumbnailGenerator;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ThumbnailGeneratorTest extends TestCase
{
    public function test_invalid_image_contents_return_null(): void
    {
        Storage::fake('uploads');

        $this->assertNull(
            (new ThumbnailGenerator)->generate('not an image', 'thumbnails/bad.png')
        );

        Storage::disk('uploads')->assertMissing('thumbnails/bad.png');
    }

    public function test_valid_image_contents_are_resampled_to_square_png(): void
    {
        Storage::fake('uploads');

        $contents = UploadedFile::fake()->image('wide.jpg', 400, 200)->get();

        $path = (new ThumbnailGenerator)->generate($contents, 'thumbnails/wide.png');

        $this->assertSame('thumbnails/wide.png', $path);
        Storage::disk('uploads')->assertExists($path);

        $size = getimagesizefromstring(Storage::disk('uploads')->get($path));

        $this->assertSame(200, $size[0]);
        $this->assertSame(200, $size[1]);
    }
}
