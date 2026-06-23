<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class FileController extends Controller
{
    /**
     * Filesystem disk rooted at storage/app, so uploads land in
     * storage/app/uploads and thumbnails in storage/app/thumbnails.
     */
    private const DISK = 'uploads';

    /**
     * Side length (in pixels) of generated image thumbnails.
     */
    private const THUMBNAIL_SIZE = 200;

    /**
     * List stored files, paginated 20 per page.
     */
    public function index(): JsonResponse
    {
        return response()->json(File::query()->latest()->paginate(20));
    }

    /**
     * Store an uploaded file, rejecting content that already exists.
     */
    public function upload(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file'],
        ]);

        /** @var UploadedFile $uploaded */
        $uploaded = $request->file('file');

        $checksum = hash_file('sha256', $uploaded->getRealPath());

        if (File::query()->where('checksum_sha256', $checksum)->exists()) {
            return response()->json([
                'message' => 'A file with identical contents already exists.',
                'checksum_sha256' => $checksum,
            ], 409);
        }

        $disk = Storage::disk(self::DISK);
        $mimeType = $uploaded->getMimeType() ?: $uploaded->getClientMimeType() ?: 'application/octet-stream';

        $storedPath = $disk->putFile('uploads/'.now()->format('Y/m/d'), $uploaded);

        $file = File::query()->create([
            'original_name' => $uploaded->getClientOriginalName(),
            'stored_path' => $storedPath,
            'mime_type' => $mimeType,
            'size_bytes' => $uploaded->getSize(),
            'checksum_sha256' => $checksum,
            'uploaded_by' => $request->user()?->id,
            'thumbnail_path' => $this->generateThumbnail($disk, $uploaded, $mimeType, $checksum),
        ]);

        return response()->json($file, 201);
    }

    /**
     * Stream a stored file back to the client with its original name.
     */
    public function download(File $file): StreamedResponse
    {
        $disk = Storage::disk(self::DISK);

        abort_unless($disk->exists($file->stored_path), 404);

        return $disk->download($file->stored_path, $file->original_name, [
            'Content-Type' => $file->mime_type,
        ]);
    }

    /**
     * Remove a file from disk (including its thumbnail) and the database.
     */
    public function destroy(File $file): JsonResponse
    {
        $disk = Storage::disk(self::DISK);

        $disk->delete($file->stored_path);

        if ($file->thumbnail_path !== null) {
            $disk->delete($file->thumbnail_path);
        }

        $file->delete();

        return response()->json(['message' => 'File deleted.']);
    }

    /**
     * Generate a square thumbnail for image uploads using GD.
     *
     * Returns null for non-image uploads or content GD cannot decode.
     */
    private function generateThumbnail(Filesystem $disk, UploadedFile $uploaded, string $mimeType, string $checksum): ?string
    {
        if (! str_starts_with($mimeType, 'image/')) {
            return null;
        }

        $contents = file_get_contents($uploaded->getRealPath());
        $source = @imagecreatefromstring($contents);

        if ($source === false) {
            return null;
        }

        $thumbnail = imagecreatetruecolor(self::THUMBNAIL_SIZE, self::THUMBNAIL_SIZE);
        imagealphablending($thumbnail, false);
        imagesavealpha($thumbnail, true);

        imagecopyresampled(
            $thumbnail,
            $source,
            0, 0, 0, 0,
            self::THUMBNAIL_SIZE, self::THUMBNAIL_SIZE,
            imagesx($source), imagesy($source)
        );

        ob_start();
        imagepng($thumbnail);
        $data = ob_get_clean();

        imagedestroy($source);
        imagedestroy($thumbnail);

        $path = 'thumbnails/'.$checksum.'.png';
        $disk->put($path, $data);

        return $path;
    }
}
