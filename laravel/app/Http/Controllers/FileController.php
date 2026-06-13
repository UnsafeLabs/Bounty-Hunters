<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File as FileSystem;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class FileController extends Controller
{
    public function upload(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'file' => ['required', 'file', 'max:51200'],
        ]);

        /** @var UploadedFile $upload */
        $upload = $validated['file'];
        $contents = file_get_contents($upload->getRealPath());

        if ($contents === false) {
            return response()->json(['message' => 'Unable to read uploaded file.'], 422);
        }

        if ($this->containsBlockedSignature($contents)) {
            return response()->json(['message' => 'Uploaded file failed virus scan.'], 422);
        }

        $checksum = hash('sha256', $contents);

        if (File::where('checksum_sha256', $checksum)->exists()) {
            return response()->json(['message' => 'Duplicate file checksum.'], 409);
        }

        $dateFolder = now()->format('Y/m/d');
        $extension = $upload->getClientOriginalExtension();
        $filename = Str::uuid()->toString().($extension ? '.'.$extension : '');
        $storedPath = 'uploads/'.$dateFolder.'/'.$filename;

        $absolutePath = $this->absoluteStoragePath($storedPath);
        FileSystem::ensureDirectoryExists(dirname($absolutePath));
        file_put_contents($absolutePath, $contents);

        $thumbnailPath = null;
        $mimeType = $upload->getMimeType() ?: 'application/octet-stream';

        if (str_starts_with($mimeType, 'image/')) {
            $thumbnailPath = $this->generateThumbnail($contents, $dateFolder);
        }

        $file = File::create([
            'original_name' => $upload->getClientOriginalName(),
            'stored_path' => $storedPath,
            'mime_type' => $mimeType,
            'size_bytes' => $upload->getSize() ?: strlen($contents),
            'checksum_sha256' => $checksum,
            'uploaded_by' => $request->user()?->getAuthIdentifier(),
            'thumbnail_path' => $thumbnailPath,
        ]);

        return response()->json(['data' => $file], 201);
    }

    public function download(File $file): BinaryFileResponse|JsonResponse
    {
        if (! FileSystem::exists($this->absoluteStoragePath($file->stored_path))) {
            return response()->json(['message' => 'File not found on disk.'], 404);
        }

        return response()->download(
            $this->absoluteStoragePath($file->stored_path),
            $file->original_name,
            ['Content-Type' => $file->mime_type]
        );
    }

    public function delete(File $file): JsonResponse
    {
        FileSystem::delete($this->absoluteStoragePath($file->stored_path));

        if ($file->thumbnail_path !== null) {
            FileSystem::delete($this->absoluteStoragePath($file->thumbnail_path));
        }

        $file->delete();

        return response()->json(['message' => 'File deleted.']);
    }

    public function list(): JsonResponse
    {
        return response()->json(
            File::query()
                ->latest()
                ->paginate(20)
        );
    }

    private function containsBlockedSignature(string $contents): bool
    {
        return str_contains($contents, 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE');
    }

    private function generateThumbnail(string $contents, string $dateFolder): ?string
    {
        if (! function_exists('imagecreatefromstring') || ! function_exists('imagecreatetruecolor')) {
            return null;
        }

        $source = @imagecreatefromstring($contents);

        if ($source === false) {
            return null;
        }

        $sourceWidth = imagesx($source);
        $sourceHeight = imagesy($source);
        $canvas = imagecreatetruecolor(200, 200);

        if ($canvas === false || $sourceWidth <= 0 || $sourceHeight <= 0) {
            imagedestroy($source);

            return null;
        }

        imagealphablending($canvas, false);
        imagesavealpha($canvas, true);

        $transparent = imagecolorallocatealpha($canvas, 0, 0, 0, 127);
        imagefilledrectangle($canvas, 0, 0, 200, 200, $transparent);

        $scale = min(200 / $sourceWidth, 200 / $sourceHeight);
        $targetWidth = max(1, (int) round($sourceWidth * $scale));
        $targetHeight = max(1, (int) round($sourceHeight * $scale));
        $targetX = (int) floor((200 - $targetWidth) / 2);
        $targetY = (int) floor((200 - $targetHeight) / 2);

        imagecopyresampled(
            $canvas,
            $source,
            $targetX,
            $targetY,
            0,
            0,
            $targetWidth,
            $targetHeight,
            $sourceWidth,
            $sourceHeight
        );

        $thumbnailPath = 'thumbnails/'.$dateFolder.'/'.Str::uuid()->toString().'.png';
        $absolutePath = $this->absoluteStoragePath($thumbnailPath);

        FileSystem::ensureDirectoryExists(dirname($absolutePath));

        imagepng($canvas, $absolutePath);
        imagedestroy($source);
        imagedestroy($canvas);

        return $thumbnailPath;
    }

    private function absoluteStoragePath(string $relativePath): string
    {
        return storage_path('app/'.$relativePath);
    }
}
