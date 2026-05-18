<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('file_uploads', function (Blueprint $table) {
            $table->id();
            $table->string('original_name');
            $table->string('stored_path');
            $table->string('mime_type', 100);
            $table->unsignedBigInteger('size_bytes');
            $table->string('checksum_sha256', 64)->index();
            $table->unsignedBigInteger('uploaded_by')->nullable();
            $table->string('thumbnail_path')->nullable();
            $table->timestamps();

            $table->foreign('uploaded_by')->references('id')->on('users')->nullOnDelete();
            $table->index('uploaded_by');
            $table->index('mime_type');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('file_uploads');
    }
};
