<?php

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations/Migration;

class CreateFilesTable extends Migration
{
    public function up()
    {
        Schema::create('files', function (Blueprint $table) {
            $table->id();
            $table->string('original_name');
            $table->string('stored_path');
            $table->string('mime_type');
            $table->string('size_bytes');
            $table->string('checksum_sha256');
            $table->string('thumbnail_path');
            $table->timestamps();
        });
    }
}
?>