<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class File extends Model
{
    use HasFactory;

    protected $fillable = [
        'original_name',
        'stored_path',
        'mime_type',
        'size_bytes',
        'checksum_sha256',
        'uploaded_by',
        'thumbnail_path',
    ];

    protected $casts = [
        'size_bytes' => 'integer',
    ];
}