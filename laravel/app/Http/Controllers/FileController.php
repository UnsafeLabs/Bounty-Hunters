<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class FileController extends Controller
{
    private const PER_PAGE = 20;

    public function index(Request $request): JsonResponse
    {
        $page = max(1, (int) $request->query('page', 1));
        $paginator = File::query()
            ->orderByDesc('id')
            ->paginate(self::PER_PAGE, ['*'], 'page', $page);

        return response()->json([
            'data' => $paginator->items(),
            'total' => $paginator->total(),
            'page' => $paginator->currentPage(),
            'page_size' => self::PER_PAGE,
            'total_pages' => $paginator->lastPage(),
        ]);
    }

    public function upload(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'max:10240'],
        ]);

        $uploaded = $request->file('file');
        $contents = file_get_contents($uploaded->getRealPath());
        $checksum = hash('sha256', $contents);

        if (File::query()->where('checksum_sha256', $checksum)->exists()) {
            return response()->json([
                'message' => 'Duplicate file (checksum match)',
                'checksum_sha256' => $checksum,
            ], 409);
        }

        $datePath = date('Y/m/d');
        $safeName = Str::uuid()->toString() . '_' . preg_replace('/[^A-Za-z0-9._-]/', '_', $uploaded->getClientOriginalName());
        $storedPath = "uploads/{$datePath}/{$safeName}";

        Storage::disk('local')->put($storedPath, $contents);

        $mime = $uploaded->getMimeType() ?: 'application/octet-stream';
        $thumbnailPath = null;

        if (str_starts_with($mime, 'image/') && function_exists('imagecreatefromstring')) {
            $thumbnailPath = $this->makeThumbnail($contents, $datePath, $safeName);
        }

        $file = File::create([
            'original_name' => $uploaded->getClientOriginalName(),
            'stored_path' => $storedPath,
            'mime_type' => $mime,
            'size_bytes' => strlen($contents),
            'checksum_sha256' => $checksum,
            'uploaded_by' => $request->user()?->id,
            'thumbnail_path' => $thumbnailPath,
        ]);

        return response()->json([
            'data' => $file,
            'message' => 'File uploaded',
        ], 201);
    }

    public function download(int $id): StreamedResponse|JsonResponse
    {
        $file = File::query()->findOrFail($id);

        if (! Storage::disk('local')->exists($file->stored_path)) {
            return response()->json(['message' => 'File missing on disk'], 404);
        }

        return Storage::disk('local')->download(
            $file->stored_path,
            $file->original_name,
            ['Content-Type' => $file->mime_type]
        );
    }

    public function destroy(int $id): JsonResponse
    {
        $file = File::query()->findOrFail($id);

        if (Storage::disk('local')->exists($file->stored_path)) {
            Storage::disk('local')->delete($file->stored_path);
        }
        if ($file->thumbnail_path && Storage::disk('local')->exists($file->thumbnail_path)) {
            Storage::disk('local')->delete($file->thumbnail_path);
        }

        $file->delete();

        return response()->json(['message' => 'File deleted']);
    }

    /**
     * Generate a 200x200 thumbnail via GD; return storage path or null.
     */
    private function makeThumbnail(string $contents, string $datePath, string $safeName): ?string
    {
        $src = @imagecreatefromstring($contents);
        if ($src === false) {
            return null;
        }

        $sw = imagesx($src);
        $sh = imagesy($src);
        if ($sw < 1 || $sh < 1) {
            imagedestroy($src);

            return null;
        }

        $size = 200;
        $dst = imagecreatetruecolor($size, $size);
        // Preserve alpha for PNG
        imagealphablending($dst, false);
        imagesavealpha($dst, true);

        $scale = max($size / $sw, $size / $sh);
        $nw = (int) ceil($sw * $scale);
        $nh = (int) ceil($sh * $scale);
        $ox = (int) (($size - $nw) / 2);
        $oy = (int) (($size - $nh) / 2);
        imagecopyresampled($dst, $src, $ox, $oy, 0, 0, $nw, $nh, $sw, $sh);

        $thumbRel = "thumbnails/{$datePath}/{$safeName}.jpg";
        $full = storage_path('app/' . $thumbRel);
        $dir = dirname($full);
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        imagejpeg($dst, $full, 85);
        imagedestroy($src);
        imagedestroy($dst);

        return $thumbRel;
    }
}
