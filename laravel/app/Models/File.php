<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class File extends Model
{
    use HasFactory;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'original_name',
        'stored_path',
        'mime_type',
        'size_bytes',
        'checksum_sha256',
        'uploaded_by',
        'thumbnail_path',
    ];

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'size_bytes' => 'integer',
        'uploaded_by' => 'integer',
    ];

    /**
     * Get the user who uploaded the file.
     */
    public function uploader()
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    /**
     * Check if the file is an image.
     */
    public function isImage(): bool
    {
        return str_starts_with($this->mime_type, 'image/');
    }

    /**
     * Check if the file has a thumbnail.
     */
    public function hasThumbnail(): bool
    {
        return $this->thumbnail_path !== null;
    }

    /**
     * Get the full storage path for the file.
     */
    public function getFullPath(): string
    {
        return storage_path('app/' . $this->stored_path);
    }

    /**
     * Get the full storage path for the thumbnail.
     */
    public function getThumbnailFullPath(): ?string
    {
        if ($this->thumbnail_path === null) {
            return null;
        }
        return storage_path('app/' . $this->thumbnail_path);
    }
}
