<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;

#[Fillable([
    'original_name',
    'stored_path',
    'mime_type',
    'size_bytes',
    'checksum_sha256',
    'uploaded_by',
    'thumbnail_path',
])]
class File extends Model
{
    protected $casts = [
        'size_bytes' => 'integer',
    ];
}