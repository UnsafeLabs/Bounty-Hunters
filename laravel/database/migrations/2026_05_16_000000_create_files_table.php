<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('files', function (Blueprint $table) {
            $table->id();
            $table->string('original_name');
            $table->string('stored_path');
            $table->string('mime_type');
            $table->unsignedBigInteger('size_bytes');
            $table->string('checksum_sha256');
            $table->unsignedBigInteger('uploaded_by')->nullable();
            $table->string('thumbnail_path')->nullable();
            $table->timestamps();

            $table->index('checksum_sha256');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('files');
    }
};
