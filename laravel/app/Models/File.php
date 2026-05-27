<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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
    use HasFactory;

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    public function hasThumbnail(): bool
    {
        return $this->thumbnail_path !== null;
    }
}
