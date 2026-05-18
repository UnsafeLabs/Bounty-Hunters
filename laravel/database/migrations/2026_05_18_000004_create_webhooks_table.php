<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('webhooks', function (Blueprint $table) {
            $table->id();
            $table->string('url');
            $table->string('secret', 64);
            $table->json('events');
            $table->boolean('active')->default(true);
            $table->timestamps();

            $table->index('active');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('webhooks');
    }
};
