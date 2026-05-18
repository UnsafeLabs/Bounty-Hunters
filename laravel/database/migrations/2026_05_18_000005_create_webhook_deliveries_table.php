<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('webhook_deliveries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('webhook_id')->constrained()->cascadeOnDelete();
            $table->string('event');
            $table->json('payload');
            $table->integer('response_code')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamp('next_retry_at')->nullable();
            $table->timestamp('delivered_at')->nullable();
            $table->timestamps();

            $table->index(['webhook_id', 'event']);
            $table->index('next_retry_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('webhook_deliveries');
    }
};
