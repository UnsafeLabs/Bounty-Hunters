<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class File extends Model
{
    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
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
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'size_bytes' => 'integer',
            'uploaded_by' => 'integer',
        ];
    }
}
