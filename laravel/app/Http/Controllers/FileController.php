<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class FileController extends Controller
{
    /**
     * List uploaded files with pagination (20 per page).
     */
    public function index(): JsonResponse
    {
        $files = File::orderBy('created_at', 'desc')->paginate(20);
        return response()->json($files);
    }

    /**
     * Upload a file with SHA-256 deduplication and optional thumbnail.
     */
    public function upload(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'max:10240'],
        ]);

        /** @var UploadedFile $uploaded */
        $uploaded = $request->file('file');

        if (!$uploaded->isValid()) {
            return response()->json(['error' => 'Upload failed'], 422);
        }

        $path = $uploaded->getRealPath();
        $checksum = hash_file('sha256', $path);

        // Reject duplicates
        $existing = File::where('checksum_sha256', $checksum)->first();
        if ($existing) {
            return response()->json([
                'error' => 'Duplicate file',
                'existing_file' => ['id' => $existing->id, 'original_name' => $existing->original_name],
            ], 409);
        }

        $dateFolder = now()->format('Y/m/d');
        $storedPath = $uploaded->store("uploads/{$dateFolder}");

        $thumbnailPath = null;
        $mimeType = $uploaded->getMimeType();

        if (str_starts_with($mimeType, 'image/')) {
            $thumbnailPath = $this->generateThumbnail($uploaded, $dateFolder);
        }

        $file = File::create([
            'original_name' => $uploaded->getClientOriginalName(),
            'stored_path' => $storedPath,
            'mime_type' => $mimeType,
            'size_bytes' => $uploaded->getSize(),
            'checksum_sha256' => $checksum,
            'uploaded_by' => $request->user()?->id,
            'thumbnail_path' => $thumbnailPath,
        ]);

        return response()->json($file, 201);
    }

    /**
     * Download a file by streaming it with correct Content-Type.
     */
    public function download(int $id): StreamedResponse|JsonResponse
    {
        $file = File::find($id);

        if (!$file) {
            return response()->json(['error' => 'File not found'], 404);
        }

        if (!Storage::exists($file->stored_path)) {
            return response()->json(['error' => 'File missing from storage'], 404);
        }

        return Storage::download($file->stored_path, $file->original_name, [
            'Content-Type' => $file->mime_type,
        ]);
    }

    /**
     * Delete a file record and its stored file from disk.
     */
    public function destroy(int $id): JsonResponse
    {
        $file = File::find($id);

        if (!$file) {
            return response()->json(['error' => 'File not found'], 404);
        }

        Storage::disk('local')->delete($file->stored_path);

        if ($file->thumbnail_path) {
            Storage::disk('local')->delete($file->thumbnail_path);
        }

        $file->delete();

        return response()->json(['message' => 'File deleted']);
    }

    /**
     * Generate a 200x200 thumbnail for image uploads using GD.
     */
    private function generateThumbnail(UploadedFile $uploaded, string $dateFolder): ?string
    {
        $sourcePath = $uploaded->getRealPath();
        $mimeType = $uploaded->getMimeType();

        $srcImage = match ($mimeType) {
            'image/jpeg', 'image/jpg' => imagecreatefromjpeg($sourcePath),
            'image/png' => imagecreatefrompng($sourcePath),
            'image/gif' => imagecreatefromgif($sourcePath),
            'image/webp' => imagecreatefromwebp($sourcePath),
            default => null,
        };

        if (!$srcImage) {
            return null;
        }

        $origWidth = imagesx($srcImage);
        $origHeight = imagesy($srcImage);

        $thumb = imagecreatetruecolor(200, 200);

        // Preserve transparency for PNG/GIF
        if ($mimeType === 'image/png' || $mimeType === 'image/gif') {
            imagealphablending($thumb, false);
            imagesavealpha($thumb, true);
        }

        imagecopyresampled($thumb, $srcImage, 0, 0, 0, 0, 200, 200, $origWidth, $origHeight);

        $thumbDir = storage_path("app/thumbnails/{$dateFolder}");
        if (!is_dir($thumbDir)) {
            mkdir($thumbDir, 0755, true);
        }

        $thumbFilename = 'thumb_' . $uploaded->hashName();
        $thumbFullPath = "{$thumbDir}/{$thumbFilename}";

        imagejpeg($thumb, $thumbFullPath, 85);
        imagedestroy($srcImage);
        imagedestroy($thumb);

        return "thumbnails/{$dateFolder}/{$thumbFilename}";
    }
}