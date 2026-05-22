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
        Schema::create('roles', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->string('guard_name');
            $table->timestamps();
        });

        Schema::create('permissions', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->string('guard_name');
            $table->timestamps();
        });

        Schema::create('role_has_permissions', function (Blueprint $table) {
            $table->foreignId('role_id')->constrained()->cascadeOnDelete();
            $table->foreignId('permission_id')->constrained()->cascadeOnDelete();
            $table->primary(['role_id', 'permission_id']);
        });

        Schema::create('model_has_roles', function (Blueprint $table) {
            $table->string('model_type');
            $table->unsignedBigInteger('model_id');
            $table->foreignId('role_id')->constrained()->cascadeOnDelete();
            $table->index(['model_type', 'model_id']);
            $table->primary(['model_type', 'model_id', 'role_id']);
        });

        Schema::create('model_has_permissions', function (Blueprint $table) {
            $table->string('model_type');
            $table->unsignedBigInteger('model_id');
            $table->foreignId('permission_id')->constrained()->cascadeOnDelete();
            $table->index(['model_type', 'model_id']);
            $table->primary(['model_type', 'model_id', 'permission_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('model_has_permissions');
        Schema::dropIfExists('model_has_roles');
        Schema::dropIfExists('role_has_permissions');
        Schema::dropIfExists('permissions');
        Schema::dropIfExists('roles');
    }
};