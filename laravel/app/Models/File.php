<?php

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

class File extends Model
{
    protected $table = 'files';
    public $timestamps = false;

    protected $fillable = [
        'original_name',
        'stored_path',
        'mime_type',
        'size_bytes',
        'checksum_sha256',
        'uploaded_by',
        'thumbnail_path',
    ];

    protected $dates = ['created_at', 'updated_at'];

    public function storeFile($file)
    {
        $this->file = $file;
        $this->save();
        return $this->stored_path;
    }

    public function deleteFile($id)
    {
        $file = File::find($id);
        $file->delete();
        return redirect('/files');
    }
}