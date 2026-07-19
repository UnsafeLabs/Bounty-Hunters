<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Intervention\Image\ImageManager;

class FileUploadService
{
    public function upload(UploadedFile $file, string $directory = 'uploads'): array
    {
        $checksum = hash_file('sha256', $file->getRealPath());

        $existing = \App\Models\FileUpload::where('checksum', $checksum)->first();
        if ($existing) {
            return [
                'path' => $existing->path,
                'checksum' => $checksum,
                'duplicate' => true,
                'thumbnail' => $existing->thumbnail,
            ];
        }

        $filename = Str::random(40) . '.' . $file->getClientOriginalExtension();
        $path = $file->storeAs($directory, $filename, 'public');

        $thumbnailPath = null;
        if (str_starts_with($file->getMimeType(), 'image/')) {
            $thumbnailPath = $this->generateThumbnail($path);
        }

        return [
            'path' => $path,
            'checksum' => $checksum,
            'duplicate' => false,
            'thumbnail' => $thumbnailPath,
        ];
    }

    private function generateThumbnail(string $path): ?string
    {
        try {
            $fullPath = Storage::disk('public')->path($path);
            $thumbnailDir = dirname($path);
            $thumbnailName = 'thumb_' . basename($path);
            $thumbnailPath = $thumbnailDir . '/' . $thumbnailName;

            $manager = new ImageManager(new \Intervention\Image\Drivers\Gd\Driver());
            $image = $manager->read($fullPath);
            $image->scale(width: 200, height: 200);
            $image->save(Storage::disk('public')->path($thumbnailPath));

            return $thumbnailPath;
        } catch (\Exception $e) {
            return null;
        }
    }
}
