<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class FileUploadService
{
    protected array $allowedMimes = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'gif', 'txt'];
    protected int $maxFileSize = 50 * 1024 * 1024; // 50MB

    public function upload(UploadedFile $file, string $path = 'uploads'): array
    {
        $this->validate($file);

        $checksum = md5_file($file->path());
        $originalName = $file->getClientOriginalName();
        $storedName = Str::uuid() . '.' . $file->getClientOriginalExtension();

        $storedPath = $file->storeAs($path, $storedName, 'public');

        return [
            'original_name' => $originalName,
            'stored_name' => $storedName,
            'path' => $storedPath,
            'url' => Storage::url($storedPath),
            'size' => $file->getSize(),
            'mime' => $file->getMimeType(),
            'checksum' => $checksum,
        ];
    }

    public function validate(UploadedFile $file): void
    {
        if ($file->getSize() > $this->maxFileSize) {
            throw new \InvalidArgumentException("File exceeds maximum size of " . ($this->maxFileSize / 1024 / 1024) . "MB");
        }

        $mime = $file->getMimeType();
        $extension = $file->getClientOriginalExtension();

        if (!in_array($extension, $this->allowedMimes) && !in_array($mime, $this->allowedMimes)) {
            throw new \InvalidArgumentException("File type not allowed: {$mime}");
        }
    }

    public function delete(string $path): bool
    {
        if (Storage::exists($path)) {
            return Storage::delete($path);
        }
        return false;
    }

    public function generateThumbnail(string $path, int $width = 150): ?string
    {
        $fullPath = Storage::path($path);
        $ext = strtolower(pathinfo($fullPath, PATHINFO_EXTENSION));

        if (in_array($ext, ['jpg', 'jpeg', 'png', 'gif'])) {
            $thumbName = 'thumbs/' . pathinfo($path, PATHINFO_FILENAME) . "_{$width}.{$ext}";
            $thumbPath = Storage::path($thumbName);

            $dir = dirname($thumbPath);
            if (!is_dir($dir)) {
                mkdir($dir, 0755, true);
            }

            [$origW, $origH] = getimagesize($fullPath);
            $ratio = $origW / $origH;
            $height = (int)($width / $ratio);

            $src = imagecreatefromstring(file_get_contents($fullPath));
            $thumb = imagecreatetruecolor($width, $height);
            imagecopyresampled($thumb, $src, 0, 0, 0, 0, $width, $height, $origW, $origH);
            imagejpeg($thumb, $thumbPath, 80);
            imagedestroy($src);
            imagedestroy($thumb);

            return Storage::url($thumbName);
        }

        return null;
    }

    public function isDuplicate(string $checksum): bool
    {
        $fileModel = new \App\Models\UploadedFile();
        return $fileModel->where('checksum', $checksum)->exists();
    }
}
