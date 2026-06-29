<?php

namespace Tests\Feature;

use App\Scopes\ActiveScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ActiveScopeWidget extends Model
{
    protected $table = 'widgets';

    public $timestamps = false;

    protected $guarded = [];

    protected static function booted(): void
    {
        static::addGlobalScope(new ActiveScope());
    }
}

class ActiveScopeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Schema::create('widgets', function (Blueprint $table) {
            $table->id();
            $table->boolean('active')->default(true);
        });

        ActiveScopeWidget::create(['active' => true]);
        ActiveScopeWidget::create(['active' => true]);
        ActiveScopeWidget::create(['active' => false]);
    }

    public function test_it_filters_records_where_active_is_one(): void
    {
        $this->assertSame(2, ActiveScopeWidget::count());
    }

    public function test_models_can_opt_out_using_without_global_scope(): void
    {
        $this->assertSame(3, ActiveScopeWidget::withoutGlobalScope(ActiveScope::class)->count());
    }
}
