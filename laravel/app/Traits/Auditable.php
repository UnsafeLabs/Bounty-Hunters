<?php

namespace App\Traits;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

trait Auditable
{
    public static function bootAuditable(): void
    {
        static::updating(function ($model) {
            $changes = $model->getDirty();
            $original = $model->getOriginal();

            Log::info('Model updated', [
                'model' => get_class($model),
                'id' => $model->getKey(),
                'user_id' => Auth::id(),
                'changes' => $changes,
                'original' => array_intersect_key($original, $changes),
            ]);
        });

        static::created(function ($model) {
            Log::info('Model created', [
                'model' => get_class($model),
                'id' => $model->getKey(),
                'user_id' => Auth::id(),
                'attributes' => $model->getAttributes(),
            ]);
        });

        static::deleted(function ($model) {
            Log::info('Model deleted', [
                'model' => get_class($model),
                'id' => $model->getKey(),
                'user_id' => Auth::id(),
            ]);
        });
    }
}
