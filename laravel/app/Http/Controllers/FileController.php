<?php

namespace App\Http\Controllers;

use App\Models\FileUpload;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Intervention\Image\ImageManager;

class FileController extends Controller
{
    public function upload(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|max:102400', // 100MB max
        ]);

        $uploadedFile = $request->file('file');
        $checksum = hash_file('sha256', $uploadedFile->getRealPath());

        // Dedup: if same checksum exists, return existing
        $existing = FileUpload::where('checksum_sha256', $checksum)->first();
        if ($existing) {
            return response()->json([
                'message' => 'File already exists (dedup)',
                'file' => $existing,
                'duplicate' => true,
            ], 200);
        }

        $datePath = now()->format('Y/m/d');
        $storedPath = $uploadedFile->storeAs(
            "uploads/{$datePath}",
            Str::uuid() . '.' . $uploadedFile->getClientOriginalExtension(),
            'local'
        );

        $thumbnailPath = null;
        if (str_starts_with($uploadedFile->getMimeType(), 'image/')) {
            $thumbnailPath = $this->generateThumbnail($storedPath);
        }

        $file = FileUpload::create([
            'original_name' => $uploadedFile->getClientOriginalName(),
            'stored_path' => $storedPath,
            'mime_type' => $uploadedFile->getMimeType(),
            'size_bytes' => $uploadedFile->getSize(),
            'checksum_sha256' => $checksum,
            'uploaded_by' => Auth::id(),
            'thumbnail_path' => $thumbnailPath,
        ]);

        return response()->json([
            'message' => 'File uploaded',
            'file' => $file,
        ], 201);
    }

    public function download(FileUpload $file): mixed
    {
        if (!Storage::disk('local')->exists($file->stored_path)) {
            abort(404, 'File not found on disk');
        }

        return Storage::disk('local')->download(
            $file->stored_path,
            $file->original_name
        );
    }

    public function delete(FileUpload $file): JsonResponse
    {
        $this->authorizeFile($file);

        Storage::disk('local')->delete($file->stored_path);
        if ($file->thumbnail_path) {
            Storage::disk('local')->delete($file->thumbnail_path);
        }

        $file->delete();

        return response()->json(['message' => 'File deleted']);
    }

    public function list(Request $request): JsonResponse
    {
        $query = FileUpload::where('uploaded_by', Auth::id());

        if ($request->has('mime_type')) {
            $query->where('mime_type', 'like', $request->mime_type . '%');
        }

        $files = $query->orderBy('created_at', 'desc')
            ->paginate($request->get('per_page', 25));

        return response()->json($files);
    }

    private function generateThumbnail(string $path): ?string
    {
        try {
            $fullPath = Storage::disk('local')->path($path);
            $manager = new ImageManager();
            $image = $manager->read($fullPath);
            $image->scale(width: 150, height: 150);

            $thumbPath = 'thumbnails/' . basename($path);
            Storage::disk('local')->put($thumbPath, $image->toJpeg()->toString());

            return $thumbPath;
        } catch (\Throwable $e) {
            report($e);
            return null;
        }
    }

    private function authorizeFile(FileUpload $file): void
    {
        if ($file->uploaded_by !== Auth::id()) {
            abort(403, 'You do not own this file.');
        }
    }
}
