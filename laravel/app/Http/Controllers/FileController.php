<?php

namespace App\Http\Controllers;

use App\Models\File;
use GdImage;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class FileController extends Controller
{
    private const UPLOAD_DISK = 'uploads';

    private const THUMBNAIL_DISK = 'thumbnails';

    private const THUMBNAIL_SIZE = 200;

    private const PER_PAGE = 20;

    public function index(): JsonResponse
    {
        return response()->json(
            File::query()->orderByDesc('id')->paginate(self::PER_PAGE)
        );
    }

    public function upload(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'max:10240'],
        ]);

        $uploaded = $request->file('file');
        $checksum = hash('sha256', (string) file_get_contents($uploaded->getRealPath()));

        if (File::query()->where('checksum_sha256', $checksum)->exists()) {
            return $this->conflict($checksum);
        }

        $storedPath = Storage::disk(self::UPLOAD_DISK)->putFile(
            now()->format('Y/m/d'),
            $uploaded
        );

        if ($storedPath === false) {
            return response()->json(['message' => 'The file could not be stored.'], Response::HTTP_INTERNAL_SERVER_ERROR);
        }

        $thumbnailPath = $this->generateThumbnail(
            Storage::disk(self::UPLOAD_DISK)->path($storedPath),
            $checksum
        );

        try {
            $file = File::create([
                'original_name' => $uploaded->getClientOriginalName(),
                'stored_path' => $storedPath,
                'mime_type' => $uploaded->getClientMimeType() ?: $uploaded->getMimeType(),
                'size_bytes' => $uploaded->getSize(),
                'checksum_sha256' => $checksum,
                'uploaded_by' => $request->user()?->getKey(),
                'thumbnail_path' => $thumbnailPath,
            ]);
        } catch (QueryException) {
            // Lost the race against a concurrent upload of identical content: roll back the stored file.
            $this->deleteStoredFiles($storedPath, $thumbnailPath);

            return $this->conflict($checksum);
        }

        return response()->json($file, Response::HTTP_CREATED);
    }

    public function download(File $file): StreamedResponse
    {
        abort_unless(
            Storage::disk(self::UPLOAD_DISK)->exists($file->stored_path),
            Response::HTTP_NOT_FOUND,
            'The file is no longer available.'
        );

        return Storage::disk(self::UPLOAD_DISK)->download(
            $file->stored_path,
            $file->original_name,
            ['Content-Type' => $file->mime_type]
        );
    }

    public function destroy(File $file): Response
    {
        $this->deleteStoredFiles($file->stored_path, $file->thumbnail_path);

        $file->delete();

        return response()->noContent();
    }

    private function conflict(string $checksum): JsonResponse
    {
        return response()->json([
            'message' => 'A file with the same checksum already exists.',
            'checksum_sha256' => $checksum,
        ], Response::HTTP_CONFLICT);
    }

    private function deleteStoredFiles(?string $storedPath, ?string $thumbnailPath): void
    {
        if ($storedPath !== null) {
            Storage::disk(self::UPLOAD_DISK)->delete($storedPath);
        }

        if ($thumbnailPath !== null) {
            Storage::disk(self::THUMBNAIL_DISK)->delete($thumbnailPath);
        }
    }

    /**
     * Build a THUMBNAIL_SIZE square PNG preview for image uploads.
     *
     * Returns the thumbnail path relative to the thumbnails disk, or null when the
     * upload is not an image GD can decode.
     */
    private function generateThumbnail(string $sourcePath, string $checksum): ?string
    {
        $info = @getimagesize($sourcePath);

        if ($info === false) {
            return null;
        }

        $reader = match ($info['mime'] ?? '') {
            'image/jpeg' => 'imagecreatefromjpeg',
            'image/png' => 'imagecreatefrompng',
            'image/gif' => 'imagecreatefromgif',
            'image/webp' => 'imagecreatefromwebp',
            'image/bmp' => 'imagecreatefrombmp',
            default => null,
        };

        if ($reader === null || ! function_exists($reader)) {
            return null;
        }

        $source = @$reader($sourcePath);

        if (! $source instanceof GdImage) {
            return null;
        }

        $thumbnail = $this->scaleToSquare($source, $info[0], $info[1]);

        try {
            ob_start();
            imagepng($thumbnail, null, 8);
            $bytes = (string) ob_get_clean();
        } finally {
            imagedestroy($source);
            imagedestroy($thumbnail);
        }

        $path = $checksum.'.png';
        Storage::disk(self::THUMBNAIL_DISK)->put($path, $bytes);

        return $path;
    }

    private function scaleToSquare(GdImage $source, int $width, int $height): GdImage
    {
        $size = self::THUMBNAIL_SIZE;
        $thumbnail = imagecreatetruecolor($size, $size);

        imagealphablending($thumbnail, false);
        imagesavealpha($thumbnail, true);
        imagefill($thumbnail, 0, 0, imagecolorallocatealpha($thumbnail, 0, 0, 0, 127));
        imagealphablending($thumbnail, true);

        $scale = min($size / max($width, 1), $size / max($height, 1));
        $targetWidth = max(1, (int) round($width * $scale));
        $targetHeight = max(1, (int) round($height * $scale));

        imagecopyresampled(
            $thumbnail,
            $source,
            (int) (($size - $targetWidth) / 2),
            (int) (($size - $targetHeight) / 2),
            0,
            0,
            $targetWidth,
            $targetHeight,
            $width,
            $height
        );

        return $thumbnail;
    }
}
