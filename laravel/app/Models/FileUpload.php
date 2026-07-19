<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class FileUpload extends Model
{
    use HasFactory;

    protected $fillable = ['path', 'checksum', 'thumbnail', 'mime_type', 'size'];
}
