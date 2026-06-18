<?php

namespace App\Http\Controllers;

use App\Models\File as StoredFile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class FileController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(StoredFile::query()->latest()->paginate(20));
    }

    public function upload(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'max:10240'],
        ]);

        $upload = $request->file('file');
        $checksum = hash_file('sha256', $upload->getRealPath());

        if (StoredFile::query()->where('checksum_sha256', $checksum)->exists()) {
            return response()->json(['message' => 'Duplicate file checksum'], 409);
        }

        if ($this->containsVirusSignature($upload->getRealPath())) {
            return response()->json(['message' => 'File failed virus scan'], 422);
        }

        $storedPath = $upload->storeAs(
            'uploads/'.now()->format('Y/m/d'),
            (string) Str::uuid().'.'.$upload->getClientOriginalExtension(),
            'local'
        );

        $file = StoredFile::query()->create([
            'original_name' => $upload->getClientOriginalName(),
            'stored_path' => $storedPath,
            'mime_type' => $upload->getMimeType() ?: 'application/octet-stream',
            'size_bytes' => $upload->getSize(),
            'checksum_sha256' => $checksum,
            'uploaded_by' => $request->user()?->id,
            'thumbnail_path' => null,
        ]);

        if (str_starts_with($file->mime_type, 'image/')) {
            $file->forceFill([
                'thumbnail_path' => $this->generateThumbnail($file),
            ])->save();
        }

        return response()->json($file->refresh(), 201);
    }

    public function download(StoredFile $file): BinaryFileResponse
    {
        abort_unless(Storage::disk('local')->exists($file->stored_path), 404);

        return response()->download(
            Storage::disk('local')->path($file->stored_path),
            $file->original_name,
            ['Content-Type' => $file->mime_type]
        );
    }

    public function destroy(StoredFile $file): Response
    {
        Storage::disk('local')->delete(array_filter([
            $file->stored_path,
            $file->thumbnail_path,
        ]));

        $file->delete();

        return response()->noContent();
    }

    private function containsVirusSignature(string $path): bool
    {
        $contents = file_get_contents($path);

        return $contents !== false && str_contains($contents, 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE');
    }

    private function generateThumbnail(StoredFile $file): string
    {
        $source = imagecreatefromstring(Storage::disk('local')->get($file->stored_path));
        abort_unless($source !== false, 422, 'Image thumbnail generation failed');

        $thumbnail = imagecreatetruecolor(200, 200);
        imagealphablending($thumbnail, false);
        imagesavealpha($thumbnail, true);

        $width = imagesx($source);
        $height = imagesy($source);
        imagecopyresampled($thumbnail, $source, 0, 0, 0, 0, 200, 200, $width, $height);

        $thumbnailPath = 'thumbnails/'.now()->format('Y/m/d').'/'.Str::uuid().'.png';
        $absolutePath = Storage::disk('local')->path($thumbnailPath);

        if (! is_dir(dirname($absolutePath))) {
            mkdir(dirname($absolutePath), 0755, true);
        }

        imagepng($thumbnail, $absolutePath);
        imagedestroy($source);
        imagedestroy($thumbnail);

        return $thumbnailPath;
    }
}
