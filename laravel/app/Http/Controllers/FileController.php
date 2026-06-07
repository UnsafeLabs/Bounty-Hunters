<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class FileController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(
            File::query()->latest()->paginate(20)
        );
    }

    public function upload(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'file' => ['required', 'file'],
        ]);

        $uploadedFile = $validated['file'];
        $checksum = hash_file('sha256', $uploadedFile->getRealPath());

        if (File::query()->where('checksum_sha256', $checksum)->exists()) {
            return response()->json([
                'message' => 'Duplicate file',
                'checksum_sha256' => $checksum,
            ], 409);
        }

        $dateFolder = now()->format('Y/m/d');
        $extension = $uploadedFile->getClientOriginalExtension();
        $filename = (string) Str::uuid().($extension ? '.'.$extension : '');
        $storedPath = $uploadedFile->storeAs("uploads/{$dateFolder}", $filename);

        $record = File::query()->create([
            'original_name' => $uploadedFile->getClientOriginalName(),
            'stored_path' => $storedPath,
            'mime_type' => $uploadedFile->getMimeType() ?: 'application/octet-stream',
            'size_bytes' => $uploadedFile->getSize(),
            'checksum_sha256' => $checksum,
            'uploaded_by' => optional($request->user())->id,
            'thumbnail_path' => null,
        ]);

        if ($record->isImage()) {
            $record->thumbnail_path = $this->generateThumbnail($storedPath, $record->mime_type);
            $record->save();
        }

        return response()->json($record, 201);
    }

    public function download(File $file): StreamedResponse
    {
        abort_unless(Storage::exists($file->stored_path), 404);

        return Storage::download(
            $file->stored_path,
            $file->original_name,
            ['Content-Type' => $file->mime_type]
        );
    }

    public function delete(File $file): Response
    {
        Storage::delete($file->stored_path);

        if ($file->thumbnail_path !== null) {
            Storage::delete($file->thumbnail_path);
        }

        $file->delete();

        return response()->noContent();
    }

    private function generateThumbnail(string $storedPath, string $mimeType): ?string
    {
        $absolutePath = Storage::path($storedPath);

        if (! function_exists('imagecreatetruecolor')) {
            return null;
        }

        $source = match ($mimeType) {
            'image/jpeg' => imagecreatefromjpeg($absolutePath),
            'image/png' => imagecreatefrompng($absolutePath),
            'image/gif' => imagecreatefromgif($absolutePath),
            'image/webp' => function_exists('imagecreatefromwebp') ? imagecreatefromwebp($absolutePath) : false,
            default => false,
        };

        if ($source === false) {
            return null;
        }

        $sourceWidth = imagesx($source);
        $sourceHeight = imagesy($source);
        $thumbnail = imagecreatetruecolor(200, 200);
        imagecopyresampled(
            $thumbnail,
            $source,
            0,
            0,
            0,
            0,
            200,
            200,
            $sourceWidth,
            $sourceHeight
        );

        $thumbnailPath = 'thumbnails/'.now()->format('Y/m/d').'/'.Str::uuid().'.jpg';
        Storage::makeDirectory(dirname($thumbnailPath));
        imagejpeg($thumbnail, Storage::path($thumbnailPath), 85);
        imagedestroy($source);
        imagedestroy($thumbnail);

        return $thumbnailPath;
    }
}
