<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class FileController extends Controller
{
    public function upload(Request $request)
    {
        $request->validate(['file' => 'required|file|max:102400']);
        $uploaded = $request->file('file');
        $hash = hash_file('sha256', $uploaded->getPathname());
        $existing = File::where('checksum_sha256', $hash)->first();
        if ($existing) return response()->json($existing);
        $storedPath = $uploaded->store('uploads/' . date('Y/m/d'), 'local');
        $file = File::create([
            'original_name' => $uploaded->getClientOriginalName(),
            'stored_path' => $storedPath,
            'mime_type' => $uploaded->getMimeType(),
            'size_bytes' => $uploaded->getSize(),
            'checksum_sha256' => $hash,
            'uploaded_by' => $request->user()?->id,
        ]);
        return response()->json($file, 201);
    }

    public function download($id)
    {
        $file = File::findOrFail($id);
        return Storage::download($file->stored_path, $file->original_name);
    }

    public function delete(Request $request, $id)
    {
        $file = File::findOrFail($id);
        Storage::delete($file->stored_path);
        if ($file->thumbnail_path) Storage::delete($file->thumbnail_path);
        $file->delete();
        return response()->json(['message' => 'Deleted']);
    }

    public function list(Request $request)
    {
        return File::paginate($request->get('per_page', 20));
    }
}