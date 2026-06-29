<?php

namespace Tests\Unit;

use App\Scopes\ActiveScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ActiveScopeTest extends TestCase
{
    use RefreshDatabase;

    public function test_active_scope_filters_inactive_records(): void
    {
        $this->createActiveScopeTable();
        ActiveScopeFixture::query()->insert([
            ['name' => 'Active record', 'active' => 1],
            ['name' => 'Inactive record', 'active' => 0],
        ]);

        $this->assertSame(['Active record'], ActiveScopeFixture::query()->pluck('name')->all());
    }

    public function test_models_can_remove_active_scope(): void
    {
        $this->createActiveScopeTable();
        ActiveScopeFixture::query()->insert([
            ['name' => 'Active record', 'active' => 1],
            ['name' => 'Inactive record', 'active' => 0],
        ]);

        $names = ActiveScopeFixture::withoutGlobalScope(ActiveScope::class)
            ->orderBy('id')
            ->pluck('name')
            ->all();

        $this->assertSame(['Active record', 'Inactive record'], $names);
    }

    private function createActiveScopeTable(): void
    {
        Schema::create('active_scope_fixtures', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->boolean('active')->default(true);
        });
    }
}

class ActiveScopeFixture extends Model
{
    protected $table = 'active_scope_fixtures';

    public $timestamps = false;

    protected $guarded = [];

    protected static function booted(): void
    {
        static::addGlobalScope(new ActiveScope());
    }
}
