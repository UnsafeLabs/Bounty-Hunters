<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Intervention\Image\ImageManagerStatic as Image;

class FileController extends Controller
{
    public function upload(Request $request)
    {
        // Validate request
        $request->validate([
            'file' => 'required|file'
        ]);

        $uploadedFile = $request->file('file');
        $originalName = $uploadedFile->getClientOriginalName();
        $mimeType = $uploadedFile->getMimeType();
        $size = $uploadedFile->getSize();
        $checksum = hash_file('sha256', $uploadedFile->getPathname());

        // Check for duplicate files
        $existingFile = File::where('checksum_sha256', $checksum)->first();
        if ($existingFile) {
            return response()->json(['error' => 'File already exists'], 409);
        }

        // Generate file path
        $year = now()->year;
        $month = now()->month;
        $day = now()->day;
        $directory = storage_path("app/uploads/{$year}/{$month}/{$day}/");
        if (!Storage::exists($directory)) {
            Storage::makeDirectory($directory);
        }

        // Store file
        $path = $directory . '/' . $uploadedFile->hashName();
        $storedFile = $uploadedFile->storeAs("uploads/{$year}/{$month}/{$day}", $uploadedFile->hashName(), 'local');

        // Save to database
        $fileRecord = new File();
        $fileRecord->original_name = $originalName;
        $fileRecord->stored_path = $storedFile;
        $fileRecord->mime_type = $mimeType;
        $fileRecord->size_bytes = $size;
        $fileRecord->checksum_sha256 = $checksum;
        $fileRecord->save();

        // Generate thumbnail if image
        if (Str::startsWith($mimeType, 'image/')) {
            $thumbnailPath = storage_path('app/thumbnails/');
            if (!Storage::exists($thumbnailPath)) {
                Storage::makeDirectory($thumbnailPath);
            }
            $image = Image::make($uploadedFile->getPathname());
            $image->resize(200, 200);
            $image->save($thumbnailPath . $storedFile);
            $fileRecord->thumbnail_path = $thumbnailPath . $storedFile;
            $fileRecord->save();
        }

        return response()->json($fileRecord);
    }

    public function download($id)
    {
        $file = File::find($id);
        if (!$file) {
            return response()->json(['error' => 'File not found'], 404);
        }

        $path = storage_path('app/' . $file->stored_path);
        return response()->download($path, $file->original_name, [], 'attachment');
    }

    public function delete($id)
    {
        $file = File::find($id);
        if (!$file) {
            return response()->json(['error' => 'File not found'], 404);
        }

        $filePath = storage_path('app/' . $file->stored_path);
        if (file_exists($filePath)) {
            unlink($filePath);
        }

        $file->delete();

        return response()->json(['message' => 'File deleted']);
    }

    public function list()
    {
        $files = File::paginate(20);
        return response()->json($files);
    }
}