<?php

namespace App\Http\Controllers;

use App\Models\File;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class FileController extends Controller
{
    public function upload(Request $request)
    {
        $request->validate([
            "file" => "required|file|max:102400",
        ]);

        $uploaded = $request->file("file");
        $contents = file_get_contents($uploaded->getPathname());
        $checksum = hash("sha256", $contents);

        $existing = File::findByChecksum($checksum);
        if ($existing) {
            return response()->json(["error" => "Duplicate file", "checksum" => $checksum], 409);
        }

        $datePath = now()->format("Y/m/d");
        $storedPath = $uploaded->store("uploads/".$datePath, "local");
        $mimeType = $uploaded->getMimeType();
        $sizeBytes = $uploaded->getSize();
        $thumbnailPath = null;

        if (Str::startsWith($mimeType, "image/")) {
            $thumbnailPath = $this->generateThumbnail($uploaded->getPathname(), $checksum);
        }

        $file = File::create([
            "original_name" => $uploaded->getClientOriginalName(),
            "stored_path" => $storedPath,
            "mime_type" => $mimeType,
            "size_bytes" => $sizeBytes,
            "checksum_sha256" => $checksum,
            "uploaded_by" => Auth::id(),
            "thumbnail_path" => $thumbnailPath,
        ]);

        return response()->json($file, 201);
    }

    public function download(File $file)
    {
        if (!Storage::disk("local")->exists($file->stored_path)) {
            return response()->json(["error" => "File not found on disk"], 404);
        }

        return Storage::disk("local")->download($file->stored_path, $file->original_name);
    }

    public function delete(File $file)
    {
        if (Storage::disk("local")->exists($file->stored_path)) {
            Storage::disk("local")->delete($file->stored_path);
        }
        if ($file->thumbnail_path && Storage::disk("local")->exists($file->thumbnail_path)) {
            Storage::disk("local")->delete($file->thumbnail_path);
        }
        $file->delete();

        return response()->json(["message" => "File deleted"]);
    }

    public function list(Request $request)
    {
        $page = $request->get("page", 1);
        $perPage = 20;
        $files = File::orderBy("created_at", "desc")->paginate($perPage, ["*"], "page", $page);
        return response()->json($files);
    }

    private function generateThumbnail(string $sourcePath, string $checksum): string
    {
        $thumbDir = "thumbnails/".now()->format("Y/m/d");
        $thumbName = $checksum.".jpg";

        try {
            $imgInfo = getimagesize($sourcePath);
            if (!$imgInfo) return "";

            [$width, $height] = $imgInfo;
            $thumbSize = 200;
            $ratio = min($thumbSize / $width, $thumbSize / $height);
            $newW = (int)round($width * $ratio);
            $newH = (int)round($height * $ratio);

            $src = null;
            switch ($imgInfo[2]) {
                case IMAGETYPE_JPEG: $src = imagecreatefromjpeg($sourcePath); break;
                case IMAGETYPE_PNG: $src = imagecreatefrompng($sourcePath); break;
                case IMAGETYPE_GIF: $src = imagecreatefromgif($sourcePath); break;
                case IMAGETYPE_WEBP: $src = imagecreatefromwebp($sourcePath); break;
                default: return "";
            }
            if (!$src) return "";

            $thumb = imagecreatetruecolor($newW, $newH);
            imagecopyresampled($thumb, $src, 0, 0, 0, 0, $newW, $newH, $width, $height);

            $tempPath = sys_get_temp_dir()."/thumb_".$checksum.".jpg";
            imagejpeg($thumb, $tempPath, 80);
            imagedestroy($src);
            imagedestroy($thumb);

            $stored = $thumbDir."/".$thumbName;
            Storage::disk("local")->put($stored, file_get_contents($tempPath));
            unlink($tempPath);

            return $stored;
        } catch (\Exception $e) {
            return "";
        }
    }
}
