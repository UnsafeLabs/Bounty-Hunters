<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;
class Role extends Model {
    protected $fillable = ['name', 'guard_name'];
    public function permissions() {
        return $this->belongsToMany(Permission::class, 'role_has_permissions');
    }
    public function users() {
        return $this->belongsToMany(User::class, 'model_has_roles', 'role_id', 'model_id');
    }
    public static function findByName(string $name) {
        return Cache::remember("role:{$name}", 3600, fn() => static::where('name', $name)->first());
    }
}