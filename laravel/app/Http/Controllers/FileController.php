<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Auth;
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
        $originalName = $uploadedFile->getClientOriginalName();
        $mimeType = $uploadedFile->getMimeType();
        $sizeBytes = $uploadedFile->getSize();
        
        // Calculate SHA-256 checksum
        $fileContent = file_get_contents($uploadedFile->getPathname());
        $checksum = hash('sha256', $fileContent);
        
        // Check for duplicates
        $existingFile = File::where('checksum_sha256', $checksum)->first();
        if ($existingFile) {
            return response()->json([
                'message' => 'File already exists',
                'file_id' => $existingFile->id
            ], 409);
        }
        
        // Store file organized by date
        $datePath = date('Y/m/d');
        $storedPath = $uploadedFile->storeAs("uploads/{$datePath}", $originalName, 'local');
        
        // Generate thumbnail for images
        $thumbnailPath = null;
        if (strpos($mimeType, 'image/') === 0) {
            $thumbnailPath = $this->generateThumbnail($uploadedFile, $datePath);
        }
        
        // Create database record
        $file = new File();
        $file->original_name = $originalName;
        $file->stored_path = $storedPath;
        $file->mime_type = $mimeType;
        $file->size_bytes = $sizeBytes;
        $file->checksum_sha256 = $checksum;
        $file->thumbnail_path = $thumbnailPath;
        if (Auth::check()) {
            $file->uploaded_by = Auth::id();
        }
        $file->save();
        
        return response()->json([
            'message' => 'File uploaded successfully',
            'file_id' => $file->id
        ], 201);
    }
    
    public function download($id)
    {
        $file = File::findOrFail($id);
        
        if (!Storage::exists($file->stored_path)) {
            return response()->json(['message' => 'File not found'], 404);
        }
        
        return response()->file(storage_path('app/' . $file->stored_path), [
            'Content-Type' => $file->mime_type,
            'Content-Length' => $file->size_bytes,
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
        $page = $request->get('page', 1);
        $files = File::paginate(20, ['*'], 'page', $page);
        return response()->json($files);
    }
    
    private function generateThumbnail($uploadedFile, $datePath)
    {
        try {
            // Create image from file
            $image = null;
            $extension = strtolower($uploadedFile->getClientOriginalExtension());
            
            switch ($extension) {
                case 'jpg':
                case 'jpeg':
                    $image = imagecreatefromjpeg($uploadedFile->getPathname());
                    break;
                case 'png':
                    $image = imagecreatefrompng($uploadedFile->getPathname());
                    break;
                case 'gif':
                    $image = imagecreatefromgif($uploadedFile->getPathname());
                    break;
                default:
                    return null;
            }
            
            if (!$image) {
                return null;
            }
            
            // Get original dimensions
            $width = imagesx($image);
            $height = imagesy($image);
            
            // Create thumbnail
            $thumb = imagecreatetruecolor(200, 200);
            imagecopyresampled($thumb, $image, 0, 0, 0, 0, 200, 200, $width, $height);
            
            // Save thumbnail
            $thumbnailName = 'thumb_' . uniqid() . '.jpg';
            $thumbnailPath = "thumbnails/{$datePath}/{$thumbnailName}";
            $fullPath = storage_path('app/' . $thumbnailPath);
            
            // Ensure directory exists
            Storage::makeDirectory("thumbnails/{$datePath}");
            
            // Save image
            imagejpeg($thumb, $fullPath, 80);
            
            // Clean up
            imagedestroy($image);
            imagedestroy($thumb);
            
            return $thumbnailPath;
        } catch (Exception $e) {
            return null;
        }
    }
}