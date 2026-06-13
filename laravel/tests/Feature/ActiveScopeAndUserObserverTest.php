<?php

namespace Tests\Feature;

use App\Models\User;
use App\Scopes\ActiveScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Tests\TestCase;

class ActiveScopeAndUserObserverTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Schema::dropIfExists('active_scope_test_models');
        Schema::create('active_scope_test_models', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->boolean('active')->default(true);
            $table->timestamps();
        });
    }

    public function test_active_scope_filters_inactive_records(): void
    {
        ActiveScopeTestModel::create(['name' => 'visible', 'active' => true]);
        ActiveScopeTestModel::create(['name' => 'hidden', 'active' => false]);

        $this->assertSame(['visible'], ActiveScopeTestModel::query()->pluck('name')->all());
    }

    public function test_active_scope_can_be_removed(): void
    {
        ActiveScopeTestModel::create(['name' => 'visible', 'active' => true]);
        ActiveScopeTestModel::create(['name' => 'hidden', 'active' => false]);

        $names = ActiveScopeTestModel::withoutGlobalScope(ActiveScope::class)
            ->orderBy('name')
            ->pluck('name')
            ->all();

        $this->assertSame(['hidden', 'visible'], $names);
    }

    public function test_user_observer_generates_uuid_and_logs_lifecycle_events(): void
    {
        Log::spy();

        $user = User::factory()->create(['uuid' => null]);

        $this->assertNotEmpty($user->uuid);
        Log::shouldHaveReceived('info')->with('User created', \Mockery::type('array'))->once();

        $user->delete();

        Log::shouldHaveReceived('info')->with('User deleted', \Mockery::type('array'))->once();
    }

    public function test_lazy_loading_prevention_is_enabled_outside_production(): void
    {
        $this->assertTrue(Model::preventsLazyLoading());
    }
}

class ActiveScopeTestModel extends Model
{
    protected $table = 'active_scope_test_models';

    protected $fillable = [
        'name',
        'active',
    ];

    protected static function booted(): void
    {
        static::addGlobalScope(new ActiveScope());
    }
}
