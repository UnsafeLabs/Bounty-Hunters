<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class FileController extends Controller
{
    /**
     * Upload a file.
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function upload(Request $request): JsonResponse
    {
        // Validate the request
        $validator = Validator::make($request->all(), [
            'file' => 'required|file|max:102400', // Max 100MB
        ]);

        if ($validator->fails()) {
            return response()->json([
                'error' => 'Validation failed',
                'message' => $validator->errors()->first(),
            ], 400);
        }

        $file = $request->file('file');

        // Generate checksum
        $checksum = hash_file('sha256', $file->getRealPath());

        // Check for duplicate
        $existingFile = File::where('checksum_sha256', $checksum)->first();
        if ($existingFile) {
            return response()->json([
                'error' => 'Duplicate file',
                'message' => 'A file with the same checksum already exists',
                'file_id' => $existingFile->id,
            ], 409);
        }

        // Generate storage path
        $datePath = date('Y/m/d');
        $originalName = $file->getClientOriginalName();
        $extension = $file->getClientOriginalExtension();
        $storedName = Str::uuid() . '.' . $extension;
        $storedPath = 'uploads/' . $datePath . '/' . $storedName;

        // Store the file
        $filePath = $file->storeAs('uploads/' . $datePath, $storedName, 'local');

        // Generate thumbnail if it's an image
        $thumbnailPath = null;
        if (str_starts_with($file->getMimeType(), 'image/')) {
            $thumbnailPath = $this->generateThumbnail($file->getRealPath(), $storedName);
        }

        // Create database record
        $fileRecord = File::create([
            'original_name' => $originalName,
            'stored_path' => $storedPath,
            'mime_type' => $file->getMimeType(),
            'size_bytes' => $file->getSize(),
            'checksum_sha256' => $checksum,
            'uploaded_by' => $request->user()?->id,
            'thumbnail_path' => $thumbnailPath,
        ]);

        return response()->json([
            'message' => 'File uploaded successfully',
            'file' => $fileRecord,
        ], 201);
    }

    /**
     * Download a file.
     *
     * @param int $id
     * @return \Symfony\Component\HttpFoundation\StreamedResponse
     */
    public function download(int $id): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $file = File::findOrFail($id);

        $filePath = storage_path('app/' . $file->stored_path);

        if (!file_exists($filePath)) {
            abort(404, 'File not found');
        }

        $headers = [
            'Content-Type' => $file->mime_type,
            'Content-Disposition' => 'attachment; filename="' . $file->original_name . '"',
            'Content-Length' => $file->size_bytes,
        ];

        return response()->streamDownload(
            function () use ($filePath) {
                echo file_get_contents($filePath);
            },
            $file->original_name,
            $headers
        );
    }

    /**
     * Delete a file.
     *
     * @param int $id
     * @return JsonResponse
     */
    public function delete(int $id): JsonResponse
    {
        $file = File::findOrFail($id);

        // Delete file from disk
        $filePath = storage_path('app/' . $file->stored_path);
        if (file_exists($filePath)) {
            unlink($filePath);
        }

        // Delete thumbnail from disk if exists
        if ($file->thumbnail_path) {
            $thumbnailPath = storage_path('app/' . $file->thumbnail_path);
            if (file_exists($thumbnailPath)) {
                unlink($thumbnailPath);
            }
        }

        // Delete database record
        $file->delete();

        return response()->json([
            'message' => 'File deleted successfully',
        ]);
    }

    /**
     * List all files with pagination.
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function list(Request $request): JsonResponse
    {
        $perPage = $request->input('per_page', 20);
        $page = $request->input('page', 1);

        $files = File::query()
            ->orderBy('created_at', 'desc')
            ->paginate($perPage, ['*'], 'page', $page);

        return response()->json($files);
    }

    /**
     * Generate a 200x200 thumbnail from an image.
     *
     * @param string $filePath
     * @param string $originalFilename
     * @return string|null
     */
    private function generateThumbnail(string $filePath, string $originalFilename): ?string
    {
        // Get image info
        $imageInfo = getimagesize($filePath);
        if ($imageInfo === false) {
            return null;
        }

        $mimeType = $imageInfo['mime'];

        // Create image resource from file
        switch ($mimeType) {
            case 'image/jpeg':
                $source = imagecreatefromjpeg($filePath);
                break;
            case 'image/png':
                $source = imagecreatefrompng($filePath);
                break;
            case 'image/gif':
                $source = imagecreatefromgif($filePath);
                break;
            case 'image/webp':
                $source = imagecreatefromwebp($filePath);
                break;
            default:
                return null;
        }

        if ($source === false) {
            return null;
        }

        // Get original dimensions
        $originalWidth = imagesx($source);
        $originalHeight = imagesy($source);

        // Calculate thumbnail dimensions maintaining aspect ratio
        $thumbnailWidth = 200;
        $thumbnailHeight = 200;
        $ratio = min($thumbnailWidth / $originalWidth, $thumbnailHeight / $originalHeight);
        $newWidth = (int) ($originalWidth * $ratio);
        $newHeight = (int) ($originalHeight * $ratio);

        // Create thumbnail
        $thumbnail = imagecreatetruecolor($thumbnailWidth, $thumbnailHeight);

        // Preserve transparency for PNG and GIF
        if ($mimeType === 'image/png' || $mimeType === 'image/gif') {
            imagealphablending($thumbnail, false);
            imagesavealpha($thumbnail, true);
            $transparent = imagecolorallocatealpha($thumbnail, 255, 255, 255, 127);
            imagefilledrectangle($thumbnail, 0, 0, $thumbnailWidth, $thumbnailHeight, $transparent);
        }

        // Fill with background color (white for JPEG)
        $backgroundColor = imagecolorallocate($thumbnail, 255, 255, 255);
        imagefill($thumbnail, 0, 0, $backgroundColor);

        // Copy and resize source to thumbnail
        $x = (int) (($thumbnailWidth - $newWidth) / 2);
        $y = (int) (($thumbnailHeight - $newHeight) / 2);
        imagecopyresampled(
            $thumbnail, $source,
            $x, $y, 0, 0,
            $newWidth, $newHeight,
            $originalWidth, $originalHeight
        );

        // Generate thumbnail path
        $datePath = date('Y/m/d');
        $extension = pathinfo($originalFilename, PATHINFO_EXTENSION);
        $thumbnailName = Str::uuid() . '_thumb.' . $extension;
        $thumbnailStoredPath = 'thumbnails/' . $datePath . '/' . $thumbnailName;

        // Ensure directory exists
        Storage::makeDirectory('thumbnails/' . $datePath);

        // Save thumbnail
        $thumbnailFullPath = storage_path('app/' . $thumbnailStoredPath);
        
        switch ($mimeType) {
            case 'image/jpeg':
                imagejpeg($thumbnail, $thumbnailFullPath, 90);
                break;
            case 'image/png':
                imagepng($thumbnail, $thumbnailFullPath, 9);
                break;
            case 'image/gif':
                imagegif($thumbnail, $thumbnailFullPath);
                break;
            case 'image/webp':
                imagewebp($thumbnail, $thumbnailFullPath, 90);
                break;
        }

        // Clean up
        imagedestroy($source);
        imagedestroy($thumbnail);

        return $thumbnailStoredPath;
    }
}
