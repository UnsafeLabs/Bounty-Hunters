<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Response;
use Illuminate\Support\Str;
use Exception;

class FileController extends Controller
{
    public function upload(Request $request)
    {
        $request->validate([
            'file' => 'required|file|max:10240', // 10MB max
        ]);

        $uploadedFile = $request->file('file');
        
        // Calculate SHA-256 checksum
        $checksum = hash_file('sha256', $uploadedFile->getPathname());
        
        // Check for duplicate
        $existingFile = File::where('checksum_sha256', $checksum)->first();
        if ($existingFile) {
            return response()->json(['error' => 'File already exists'], 409);
        }

        // Store file
        $datePath = now()->format('Y/m/d');
        $storedPath = $uploadedFile->storeAs(
            "uploads/{$datePath}",
            $uploadedFile->getClientOriginalName(),
            'local'
        );

        // Generate thumbnail if image
        $thumbnailPath = null;
        if (Str::startsWith($uploadedFile->getMimeType(), 'image/')) {
            $thumbnailPath = $this->generateThumbnail($uploadedFile, $datePath);
        }

        // Create database record
        $file = File::create([
            'original_name' => $uploadedFile->getClientOriginalName(),
            'stored_path' => $storedPath,
            'mime_type' => $uploadedFile->getMimeType(),
            'size_bytes' => $uploadedFile->getSize(),
            'checksum_sha256' => $checksum,
            'uploaded_by' => Auth::id(),
            'thumbnail_path' => $thumbnailPath,
        ]);

        return response()->json($file, 201);
    }

    public function download($id)
    {
        $file = File::findOrFail($id);
        
        if (!Storage::exists($file->stored_path)) {
            return response()->json(['error' => 'File not found'], 404);
        }

        return response()->file(storage_path('app/' . $file->stored_path), [
            'Content-Type' => $file->mime_type,
            'Content-Disposition' => 'inline; filename="' . $file->original_name . '"'
        ]);
    }

    public function delete($id)
    {
        $file = File::findOrFail($id);
        
        // Delete file from storage
        if (Storage::exists($file->stored_path)) {
            Storage::delete($file->stored_path);
        }
        
        // Delete thumbnail if exists
        if ($file->thumbnail_path && Storage::exists($file->thumbnail_path)) {
            Storage::delete($file->thumbnail_path);
        }
        
        // Delete database record
        $file->delete();

        return response()->json(['message' => 'File deleted successfully']);
    }

    public function list(Request $request)
    {
        $files = File::paginate(20);
        return response()->json($files);
    }

    private function generateThumbnail($uploadedFile, $datePath)
    {
        try {
            // Create image resource
            $image = null;
            $mimeType = $uploadedFile->getMimeType();
            
            if ($mimeType === 'image/jpeg') {
                $image = imagecreatefromjpeg($uploadedFile->getPathname());
            } elseif ($mimeType === 'image/png') {
                $image = imagecreatefrompng($uploadedFile->getPathname());
            } elseif ($mimeType === 'image/gif') {
                $image = imagecreatefromgif($uploadedFile->getPathname());
            } else {
                return null;
            }

            if (!$image) {
                return null;
            }

            // Get original dimensions
            $width = imagesx($image);
            $height = imagesy($image);

            // Calculate new dimensions (200x200 max)
            $newWidth = 200;
            $newHeight = 200;
            
            if ($width > $height) {
                $newHeight = ($height / $width) * 200;
            } else {
                $newWidth = ($width / $height) * 200;
            }

            // Create thumbnail
            $thumbnail = imagecreatetruecolor($newWidth, $newHeight);
            
            // Preserve transparency for PNG
            if ($mimeType === 'image/png') {
                imagealphablending($thumbnail, false);
                imagesavealpha($thumbnail, true);
            }
            
            imagecopyresampled($thumbnail, $image, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);

            // Save thumbnail
            $thumbnailFileName = 'thumb_' . uniqid() . '.png';
            $thumbnailPath = "thumbnails/{$datePath}/{$thumbnailFileName}";
            $thumbnailFullPath = storage_path('app/' . $thumbnailPath);
            
            // Ensure directory exists
            Storage::makeDirectory("thumbnails/{$datePath}");
            
            // Save image
            imagepng($thumbnail, $thumbnailFullPath);

            // Free memory
            imagedestroy($image);
            imagedestroy($thumbnail);

            return $thumbnailPath;
        } catch (Exception $e) {
            return null;
        }
    }
}