<?php

namespace App\Http\Controllers;

use App\Models\File as StoredFile;
use App\Services\FileVirusScanner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File as FileSystem;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class FileController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(
            StoredFile::query()
                ->latest()
                ->paginate(20)
        );
    }

    public function upload(Request $request, FileVirusScanner $scanner): JsonResponse
    {
        $validated = $request->validate([
            'file' => ['required', 'file'],
        ]);

        /** @var UploadedFile $upload */
        $upload = $validated['file'];

        if (! $scanner->isClean($upload)) {
            return response()->json([
                'message' => 'The uploaded file failed virus scanning.',
            ], Response::HTTP_UNPROCESSABLE_ENTITY);
        }

        $checksum = hash_file('sha256', $upload->getRealPath());

        if (StoredFile::query()->where('checksum_sha256', $checksum)->exists()) {
            return response()->json([
                'message' => 'A file with the same checksum already exists.',
            ], Response::HTTP_CONFLICT);
        }

        $mimeType = $upload->getMimeType();
        $originalName = $upload->getClientOriginalName();
        $dateFolder = now()->format('Y/m/d');
        $extension = $upload->guessExtension() ?: $upload->getClientOriginalExtension() ?: 'bin';
        $filename = $checksum.'.'.$extension;
        $relativePath = "uploads/{$dateFolder}/{$filename}";
        $absolutePath = storage_path("app/{$relativePath}");

        FileSystem::ensureDirectoryExists(dirname($absolutePath));
        $upload->move(dirname($absolutePath), basename($absolutePath));

        $thumbnailPath = $this->createThumbnailIfImage($absolutePath, $checksum, $dateFolder, $mimeType);

        $file = StoredFile::query()->create([
            'original_name' => $originalName,
            'stored_path' => $relativePath,
            'mime_type' => $mimeType,
            'size_bytes' => FileSystem::size($absolutePath),
            'checksum_sha256' => $checksum,
            'uploaded_by' => $request->user()?->getAuthIdentifier(),
            'thumbnail_path' => $thumbnailPath,
        ]);

        return response()->json($file, Response::HTTP_CREATED);
    }

    public function download(StoredFile $file): BinaryFileResponse
    {
        $path = storage_path("app/{$file->stored_path}");

        abort_unless(FileSystem::exists($path), Response::HTTP_NOT_FOUND);

        return response()->download($path, $file->original_name, [
            'Content-Type' => $file->mime_type ?: 'application/octet-stream',
        ]);
    }

    public function destroy(StoredFile $file): Response
    {
        FileSystem::delete(storage_path("app/{$file->stored_path}"));

        if ($file->thumbnail_path !== null) {
            FileSystem::delete(storage_path("app/{$file->thumbnail_path}"));
        }

        $file->delete();

        return response()->noContent();
    }

    private function createThumbnailIfImage(
        string $sourcePath,
        string $checksum,
        string $dateFolder,
        ?string $mimeType
    ): ?string {
        if ($mimeType === null || ! str_starts_with($mimeType, 'image/')) {
            return null;
        }

        if (! function_exists('imagecreatetruecolor')) {
            return null;
        }

        $source = $this->createImageResource($sourcePath, $mimeType);

        if ($source === null || $source === false) {
            return null;
        }

        $sourceWidth = imagesx($source);
        $sourceHeight = imagesy($source);
        $thumbnail = imagecreatetruecolor(200, 200);

        imagealphablending($thumbnail, false);
        imagesavealpha($thumbnail, true);

        $transparent = imagecolorallocatealpha($thumbnail, 0, 0, 0, 127);
        imagefilledrectangle($thumbnail, 0, 0, 200, 200, $transparent);

        $scale = min(200 / $sourceWidth, 200 / $sourceHeight);
        $targetWidth = (int) max(1, floor($sourceWidth * $scale));
        $targetHeight = (int) max(1, floor($sourceHeight * $scale));
        $targetX = (int) floor((200 - $targetWidth) / 2);
        $targetY = (int) floor((200 - $targetHeight) / 2);

        imagecopyresampled(
            $thumbnail,
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

        $relativePath = "thumbnails/{$dateFolder}/{$checksum}.png";
        $absolutePath = storage_path("app/{$relativePath}");

        FileSystem::ensureDirectoryExists(dirname($absolutePath));
        imagepng($thumbnail, $absolutePath);

        imagedestroy($source);
        imagedestroy($thumbnail);

        return $relativePath;
    }

    /**
     * @return \GdImage|resource|false|null
     */
    private function createImageResource(string $path, string $mimeType)
    {
        return match (Str::lower($mimeType)) {
            'image/jpeg' => imagecreatefromjpeg($path),
            'image/png' => imagecreatefrompng($path),
            'image/gif' => imagecreatefromgif($path),
            'image/webp' => function_exists('imagecreatefromwebp') ? imagecreatefromwebp($path) : null,
            default => null,
        };
    }
}
