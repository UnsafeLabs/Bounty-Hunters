<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
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
    protected function casts(): array
    {
        return [
            'size_bytes' => 'integer',
            'uploaded_by' => 'integer',
        ];
    }
}
