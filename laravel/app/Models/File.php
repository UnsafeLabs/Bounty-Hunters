<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class File extends Model
{
    protected $table = 'files';

    protected $fillable = [
        'original_name', 'stored_path', 'mime_type', 'size_bytes',
        'checksum_sha256', 'uploaded_by', 'thumbnail_path',
    ];

    public function uploader()
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }
}