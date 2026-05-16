<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File as FileSystem;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class FileController extends Controller
{
    public function upload(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'file' => ['required', 'file'],
        ]);

        /** @var UploadedFile $uploadedFile */
        $uploadedFile = $validated['file'];
        $originalName = $uploadedFile->getClientOriginalName();
        $mimeType = $uploadedFile->getMimeType() ?: 'application/octet-stream';
        $checksum = hash_file('sha256', $uploadedFile->getRealPath());

        if (File::query()->where('checksum_sha256', $checksum)->exists()) {
            return response()->json([
                'message' => 'A file with the same checksum already exists.',
            ], 409);
        }

        $datePath = now()->format('Y/m/d');
        $extension = $uploadedFile->getClientOriginalExtension();
        $storedName = (string) Str::uuid().($extension !== '' ? ".{$extension}" : '');
        $relativePath = "uploads/{$datePath}/{$storedName}";
        $absolutePath = storage_path("app/{$relativePath}");

        FileSystem::ensureDirectoryExists(dirname($absolutePath));
        $uploadedFile->move(dirname($absolutePath), basename($absolutePath));

        $thumbnailPath = null;

        if ($this->isSupportedImage($absolutePath)) {
            $thumbnailPath = $this->createThumbnail($absolutePath, $datePath, pathinfo($storedName, PATHINFO_FILENAME));
        }

        $file = File::query()->create([
            'original_name' => $originalName,
            'stored_path' => $relativePath,
            'mime_type' => $mimeType,
            'size_bytes' => FileSystem::size($absolutePath),
            'checksum_sha256' => $checksum,
            'uploaded_by' => optional($request->user())->getAuthIdentifier(),
            'thumbnail_path' => $thumbnailPath,
        ]);

        return response()->json([
            'data' => $file,
        ], 201);
    }

    public function download(File $file): BinaryFileResponse|JsonResponse
    {
        $absolutePath = storage_path("app/{$file->stored_path}");

        if (! FileSystem::exists($absolutePath)) {
            return response()->json([
                'message' => 'File not found on disk.',
            ], 404);
        }

        return response()->download(
            $absolutePath,
            $file->original_name,
            ['Content-Type' => $file->mime_type]
        );
    }

    public function delete(File $file): Response
    {
        FileSystem::delete(storage_path("app/{$file->stored_path}"));

        if ($file->thumbnail_path !== null) {
            FileSystem::delete(storage_path("app/{$file->thumbnail_path}"));
        }

        $file->delete();

        return response()->noContent();
    }

    public function index(): JsonResponse
    {
        return response()->json(File::query()->latest()->paginate(20));
    }

    private function isSupportedImage(string $path): bool
    {
        if (! function_exists('imagecreatefromstring')) {
            return false;
        }

        $info = @getimagesize($path);

        return is_array($info) && str_starts_with((string) $info['mime'], 'image/');
    }

    private function createThumbnail(string $sourcePath, string $datePath, string $baseName): ?string
    {
        $sourceContents = FileSystem::get($sourcePath);
        $sourceImage = @imagecreatefromstring($sourceContents);

        if ($sourceImage === false) {
            return null;
        }

        $sourceWidth = imagesx($sourceImage);
        $sourceHeight = imagesy($sourceImage);
        $thumbnail = imagecreatetruecolor(200, 200);

        imagealphablending($thumbnail, false);
        imagesavealpha($thumbnail, true);

        $transparent = imagecolorallocatealpha($thumbnail, 0, 0, 0, 127);
        imagefilledrectangle($thumbnail, 0, 0, 200, 200, $transparent);
        imagecopyresampled($thumbnail, $sourceImage, 0, 0, 0, 0, 200, 200, $sourceWidth, $sourceHeight);

        $relativePath = "thumbnails/{$datePath}/{$baseName}.png";
        $absolutePath = storage_path("app/{$relativePath}");

        FileSystem::ensureDirectoryExists(dirname($absolutePath));
        $created = imagepng($thumbnail, $absolutePath);

        imagedestroy($sourceImage);
        imagedestroy($thumbnail);

        return $created ? $relativePath : null;
    }
}
