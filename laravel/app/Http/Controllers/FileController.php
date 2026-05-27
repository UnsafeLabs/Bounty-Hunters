<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;

class FileController extends Controller
{
    /**
     * Upload a new file.
     */
    public function upload(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'file' => 'required|file|max:10240',
        ]);

        if ($validator->fails()) {
            return response()->json(['errors' => $validator->errors()], 422);
        }

        $uploadedFile = $request->file('file');

        // Generate SHA-256 checksum
        $checksum = hash_file('sha256', $uploadedFile->getRealPath());

        // Check for duplicates
        $existingFile = File::where('checksum_sha256', $checksum)->first();
        if ($existingFile) {
            return response()->json([
                'message' => 'Duplicate file detected.',
                'file' => $existingFile,
            ], 409);
        }

        // Store file in date-organized folder
        $dateFolder = now()->format('Y/m/d');
        $storedPath = $uploadedFile->store('uploads/' . $dateFolder, 'local');

        // Determine if image and generate thumbnail
        $thumbnailPath = null;
        $mimeType = $uploadedFile->getMimeType();

        if (str_starts_with($mimeType, 'image/')) {
            $thumbnailPath = $this->generateThumbnail($uploadedFile, $dateFolder);
        }

        // Create database record
        $file = File::create([
            'original_name' => $uploadedFile->getClientOriginalName(),
            'stored_path' => $storedPath,
            'mime_type' => $mimeType,
            'size_bytes' => $uploadedFile->getSize(),
            'checksum_sha256' => $checksum,
            'uploaded_by' => Auth::id(),
            'thumbnail_path' => $thumbnailPath,
        ]);

        return response()->json($file, 201);
    }

    /**
     * Generate a 200x200 thumbnail for an image.
     */
    private function generateThumbnail($uploadedFile, string $dateFolder): string
    {
        $thumbnailDir = 'thumbnails/' . $dateFolder;
        $thumbnailName = uniqid() . '.jpg';
        $thumbnailPath = $thumbnailDir . '/' . $thumbnailName;

        $fullThumbnailPath = storage_path('app/' . $thumbnailPath);

        // Ensure directory exists
        if (!file_exists(dirname($fullThumbnailPath))) {
            mkdir(dirname($fullThumbnailPath), 0755, true);
        }

        $sourceImage = imagecreatefromstring(file_get_contents($uploadedFile->getRealPath()));
        $originalWidth = imagesx($sourceImage);
        $originalHeight = imagesy($sourceImage);

        $thumbnail = imagecreatetruecolor(200, 200);
        imagecopyresampled($thumbnail, $sourceImage, 0, 0, 0, 0, 200, 200, $originalWidth, $originalHeight);

        imagejpeg($thumbnail, $fullThumbnailPath, 85);

        imagedestroy($sourceImage);
        imagedestroy($thumbnail);

        return $thumbnailPath;
    }

    /**
     * Download a file.
     */
    public function download($id)
    {
        $file = File::findOrFail($id);

        $fullPath = storage_path('app/' . $file->stored_path);

        if (!file_exists($fullPath)) {
            return response()->json(['message' => 'File not found on disk.'], 404);
        }

        return response()->streamDownload(function () use ($fullPath) {
            readfile($fullPath);
        }, $file->original_name, [
            'Content-Type' => $file->mime_type,
        ]);
    }

    /**
     * Delete a file.
     */
    public function destroy($id)
    {
        $file = File::findOrFail($id);

        // Delete files from disk
        Storage::disk('local')->delete($file->stored_path);
        if ($file->thumbnail_path) {
            Storage::disk('local')->delete($file->thumbnail_path);
        }

        $file->delete();

        return response()->json(['message' => 'File deleted successfully.']);
    }

    /**
     * List files with pagination.
     */
    public function index()
    {
        $files = File::paginate(20);

        return response()->json($files);
    }
}