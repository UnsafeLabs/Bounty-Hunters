<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Exception;

class FileController extends Controller
{
    public function upload(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'file' => 'required|file|max:10240', // 10MB max
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()], 400);
        }

        try {
            $uploadedFile = $request->file('file');
            $fileContent = file_get_contents($uploadedFile->getPathname());
            
            // Generate SHA-256 checksum
            $checksum = hash('sha256', $fileContent);
            
            // Check for duplicate
            $existingFile = File::where('checksum_sha256', $checksum)->first();
            if ($existingFile) {
                return response()->json(['error' => 'File already exists'], 409);
            }
            
            // Generate storage path with date folder
            $datePath = date('Y/m/d');
            $fileName = Str::uuid() . '.' . $uploadedFile->getClientOriginalExtension();
            $storedPath = "uploads/{$datePath}/{$fileName}";
            
            // Store file
            Storage::disk('local')->put($storedPath, $fileContent);
            
            // Initialize thumbnail path as null
            $thumbnailPath = null;
            
            // Generate thumbnail for images
            if (strpos($uploadedFile->getMimeType(), 'image/') === 0) {
                $thumbnailPath = $this->generateThumbnail($fileContent, $fileName);
            }
            
            // Create database record
            $file = new File();
            $file->original_name = $uploadedFile->getClientOriginalName();
            $file->stored_path = $storedPath;
            $file->mime_type = $uploadedFile->getMimeType();
            $file->size_bytes = $uploadedFile->getSize();
            $file->checksum_sha256 = $checksum;
            $file->thumbnail_path = $thumbnailPath;
            $file->uploaded_by = auth()->id(); // Will be null if not authenticated
            $file->save();
            
            return response()->json([
                'message' => 'File uploaded successfully',
                'file' => $file
            ], 201);
        } catch (Exception $e) {
            return response()->json(['error' => 'File upload failed: ' . $e->getMessage()], 500);
        }
    }
    
    public function download(File $file)
    {
        if (!$file->exists) {
            return response()->json(['error' => 'File not found'], 404);
        }
        
        try {
            $filePath = storage_path('app/' . $file->stored_path);
            
            if (!file_exists($filePath)) {
                return response()->json(['error' => 'File not found on disk'], 404);
            }
            
            return response()->file($filePath, [
                'Content-Type' => $file->mime_type,
                'Content-Disposition' => 'attachment; filename="' . $file->original_name . '"'
            ]);
        } catch (Exception $e) {
            return response()->json(['error' => 'File download failed: ' . $e->getMessage()], 500);
        }
    }
    
    public function delete($id)
    {
        $file = File::find($id);
        
        if (!$file) {
            return response()->json(['error' => 'File not found'], 404);
        }
        
        try {
            // Delete file from storage
            Storage::disk('local')->delete($file->stored_path);
            
            // Delete thumbnail if exists
            if ($file->thumbnail_path) {
                Storage::disk('local')->delete($file->thumbnail_path);
            }
            
            // Delete database record
            $file->delete();
            
            return response()->json(['message' => 'File deleted successfully']);
        } catch (Exception $e) {
            return response()->json(['error' => 'File deletion failed: ' . $e->getMessage()], 500);
        }
    }
    
    public function list(Request $request)
    {
        try {
            $files = File::orderBy('created_at', 'desc')->paginate(20);
            return response()->json($files);
        } catch (Exception $e) {
            return response()->json(['error' => 'Failed to retrieve files: ' . $e->getMessage()], 500);
        }
    }
    
    private function generateThumbnail($fileContent, $fileName)
    {
        try {
            // Create image from string
            $image = imagecreatefromstring($fileContent);
            
            if (!$image) {
                return null;
            }
            
            // Get original dimensions
            $width = imagesx($image);
            $height = imagesy($image);
            
            // Create thumbnail
            $thumbnail = imagecreatetruecolor(200, 200);
            imagecopyresampled($thumbnail, $image, 0, 0, 0, 0, 200, 200, $width, $height);
            
            // Save thumbnail
            $thumbnailName = 'thumb_' . $fileName;
            $thumbnailPath = 'thumbnails/' . $thumbnailName;
            imagepng($thumbnail, storage_path('app/' . $thumbnailPath));
            
            // Free memory
            imagedestroy($image);
            imagedestroy($thumbnail);
            
            return $thumbnailPath;
        } catch (Exception $e) {
            return null;
        }
    }
}