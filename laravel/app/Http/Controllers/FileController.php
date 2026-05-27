<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\File;
use Illuminate\Http\Response;

class FileController extends Controller
{
    public function index(Request $request)
    {
        $files = File::all();

        return view('files.index', compact('files'));
    }

    public function upload(Request $request)
    {
        $request->validate([
            'file' => 'required|file'
        ]);

        $file = $request->file('file');
        $path = $file->store('uploads', 'public');
        $originalName = $file->getClientOriginalName();
        $storedName = $file->hashName();

        return redirect('/files');
    }

    public function downloadFile($filename)
    {
        $path = storage_path('app/' . $filename);
        $mimeType = File::mimeType($path);
        return response()->file($path, ['Content-Type' => $mimeType]);
    }

    public function deleteFile($id)
    {
        $file = File::find($id);
        $file->delete();
        return redirect('/files');
    }

    public function listFiles()
    {
        $files = File::all();
        return view('files.list', compact('files'));
    }
}
?>