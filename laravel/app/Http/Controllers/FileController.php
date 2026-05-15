<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class FileController extends Controller
{
    public function upload(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|max:102400',
        ]);

        $uploadedFile = $request->file('file');
        $contents = file_get_contents($uploadedFile->getRealPath());
        $checksum = hash('sha256', $contents);

        $existing = File::where('checksum_sha256', $checksum)->first();
        if ($existing) {
            return response()->json([
                'error' => 'A file with this content already exists',
                'existing_file_id' => $existing->id,
            ], 409);
        }

        $datePath = now()->format('Y/m/d');
        $storedName = Str::random(40) . '.' . $uploadedFile->getClientOriginalExtension();
        $storedPath = $uploadedFile->storeAs("uploads/{$datePath}", $storedName, 'local');

        $mimeType = $uploadedFile->getMimeType();
        $thumbnailPath = null;

        if (str_starts_with($mimeType, 'image/')) {
            $thumbnailPath = $this->generateThumbnail($uploadedFile->getRealPath(), $storedName, $datePath);
        }

        $file = File::create([
            'original_name' => $uploadedFile->getClientOriginalName(),
            'stored_path' => $storedPath,
            'mime_type' => $mimeType,
            'size_bytes' => $uploadedFile->getSize(),
            'checksum_sha256' => $checksum,
            'uploaded_by' => $request->user()?->id,
            'thumbnail_path' => $thumbnailPath,
        ]);

        return response()->json($file, 201);
    }

    public function download(int $id)
    {
        $file = File::findOrFail($id);

        if (!Storage::disk('local')->exists($file->stored_path)) {
            return response()->json(['error' => 'File not found on disk'], 404);
        }

        return Storage::disk('local')->response(
            $file->stored_path,
            $file->original_name,
            ['Content-Type' => $file->mime_type]
        );
    }

    public function destroy(int $id): JsonResponse
    {
        $file = File::findOrFail($id);

        if (Storage::disk('local')->exists($file->stored_path)) {
            Storage::disk('local')->delete($file->stored_path);
        }

        if ($file->thumbnail_path && Storage::disk('local')->exists($file->thumbnail_path)) {
            Storage::disk('local')->delete($file->thumbnail_path);
        }

        $file->delete();

        return response()->json(null, 204);
    }

    public function index(Request $request): JsonResponse
    {
        $page = $request->integer('page', 1);
        $perPage = 20;

        $files = File::orderBy('created_at', 'desc')
            ->paginate($perPage, ['*'], 'page', $page);

        return response()->json($files);
    }

    private function generateThumbnail(string $sourcePath, string $storedName, string $datePath): ?string
    {
        if (!extension_loaded('gd')) {
            return null;
        }

        $imageInfo = getimagesize($sourcePath);
        if ($imageInfo === false) {
            return null;
        }

        $sourceImage = match ($imageInfo[2]) {
            IMAGETYPE_JPEG => imagecreatefromjpeg($sourcePath),
            IMAGETYPE_PNG => imagecreatefrompng($sourcePath),
            IMAGETYPE_GIF => imagecreatefromgif($sourcePath),
            IMAGETYPE_WEBP => imagecreatefromwebp($sourcePath),
            default => null,
        };

        if ($sourceImage === false || $sourceImage === null) {
            return null;
        }

        $origWidth = imagesx($sourceImage);
        $origHeight = imagesy($sourceImage);
        $thumbSize = 200;

        $ratio = min($thumbSize / $origWidth, $thumbSize / $origHeight);
        $newWidth = (int)($origWidth * $ratio);
        $newHeight = (int)($origHeight * $ratio);

        $thumb = imagecreatetruecolor($newWidth, $newHeight);
        imagecopyresampled($thumb, $sourceImage, 0, 0, 0, 0, $newWidth, $newHeight, $origWidth, $origHeight);

        $thumbDir = "thumbnails/{$datePath}";
        Storage::disk('local')->makeDirectory($thumbDir);

        $thumbPath = "{$thumbDir}/thumb_{$storedName}";
        $fullThumbPath = Storage::disk('local')->path($thumbPath);

        imagejpeg($thumb, $fullThumbPath, 85);
        imagedestroy($thumb);
        imagedestroy($sourceImage);

        return $thumbPath;
    }
}
