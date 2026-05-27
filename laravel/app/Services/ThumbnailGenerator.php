<?php

namespace App\Services;

use Illuminate\Support\Facades\Storage;

class ThumbnailGenerator
{
    public function generate(string $contents, string $path): ?string
    {
        $source = @imagecreatefromstring($contents);

        if ($source === false) {
            return null;
        }

        $thumbnail = imagecreatetruecolor(200, 200);
        imagealphablending($thumbnail, false);
        imagesavealpha($thumbnail, true);

        $transparent = imagecolorallocatealpha($thumbnail, 0, 0, 0, 127);
        imagefilledrectangle($thumbnail, 0, 0, 200, 200, $transparent);

        imagecopyresampled(
            $thumbnail,
            $source,
            0,
            0,
            0,
            0,
            200,
            200,
            imagesx($source),
            imagesy($source)
        );

        ob_start();
        imagepng($thumbnail);
        $thumbnailContents = ob_get_clean();

        imagedestroy($source);
        imagedestroy($thumbnail);

        if ($thumbnailContents === false) {
            return null;
        }

        Storage::disk('uploads')->put($path, $thumbnailContents);

        return $path;
    }
}
