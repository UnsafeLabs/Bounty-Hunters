<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('notification_preferences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // Bounded lengths keep the composite unique index below the 767-byte
            // prefix limit older MySQL/InnoDB engines impose on utf8mb4. The
            // values come from a short configured list, so this is ample.
            $table->string('event_type', 64);
            $table->string('channel', 32);
            $table->boolean('enabled')->default(true);
            $table->timestamps();

            $table->unique(['user_id', 'event_type', 'channel']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('notification_preferences');
    }
};
