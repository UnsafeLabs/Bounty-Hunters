<?php

namespace App\Http\Controllers;

use App\Models\File as StoredFile;
use App\Services\ThumbnailGenerator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class FileController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(
            StoredFile::query()->latest()->paginate(20)
        );
    }

    public function upload(Request $request, ThumbnailGenerator $thumbnails): JsonResponse
    {
        $validated = $request->validate([
            'file' => ['required', 'file', 'max:10240'],
        ]);

        $upload = $validated['file'];
        $contents = $upload->get();
        $checksum = hash('sha256', $contents);

        if (StoredFile::query()->where('checksum_sha256', $checksum)->exists()) {
            return response()->json([
                'message' => 'A file with this checksum already exists.',
                'checksum_sha256' => $checksum,
            ], 409);
        }

        $datePath = now()->format('Y/m/d');
        $extension = $upload->guessExtension() ?: $upload->getClientOriginalExtension() ?: 'bin';
        $storedPath = "uploads/{$datePath}/{$checksum}.{$extension}";
        $mimeType = $upload->getMimeType() ?: 'application/octet-stream';
        $thumbnailPath = null;

        Storage::disk('uploads')->put($storedPath, $contents);

        if (Str::startsWith($mimeType, 'image/')) {
            $thumbnailPath = $thumbnails->generate(
                $contents,
                "thumbnails/{$datePath}/{$checksum}.png"
            );
        }

        $file = StoredFile::query()->create([
            'original_name' => $upload->getClientOriginalName(),
            'stored_path' => $storedPath,
            'mime_type' => $mimeType,
            'size_bytes' => $upload->getSize(),
            'checksum_sha256' => $checksum,
            'uploaded_by' => $request->user()?->id,
            'thumbnail_path' => $thumbnailPath,
        ]);

        return response()->json([
            'data' => $file,
        ], 201);
    }

    public function download(StoredFile $file): StreamedResponse
    {
        abort_unless(Storage::disk('uploads')->exists($file->stored_path), 404);

        return Storage::disk('uploads')->download(
            $file->stored_path,
            $file->original_name,
            ['Content-Type' => $file->mime_type]
        );
    }

    public function destroy(StoredFile $file): JsonResponse
    {
        Storage::disk('uploads')->delete($file->stored_path);

        if ($file->thumbnail_path !== null) {
            Storage::disk('uploads')->delete($file->thumbnail_path);
        }

        $file->delete();

        return response()->json(status: 204);
    }
}
