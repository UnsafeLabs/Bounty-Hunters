<?php

namespace Tests\Feature;

use App\Models\User;
use App\Scopes\ActiveScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ModelLifecycleTest extends TestCase
{
    use RefreshDatabase;

    public function test_active_scope_filters_active_records_and_can_be_removed(): void
    {
        Schema::create('active_scope_test_models', function (Blueprint $table) {
            $table->id();
            $table->boolean('active')->default(true);
            $table->string('name');
            $table->timestamps();
        });

        ActiveScopeTestModel::create(['name' => 'visible', 'active' => true]);
        ActiveScopeTestModel::create(['name' => 'hidden', 'active' => false]);

        $this->assertSame(['visible'], ActiveScopeTestModel::pluck('name')->all());
        $this->assertSame(
            ['hidden', 'visible'],
            ActiveScopeTestModel::withoutGlobalScope(ActiveScope::class)
                ->orderBy('name')
                ->pluck('name')
                ->all(),
        );
    }

    public function test_user_observer_assigns_uuid_and_logs_lifecycle_events(): void
    {
        Log::spy();

        $user = User::factory()->create();

        $this->assertNotEmpty($user->uuid);
        $this->assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/',
            $user->uuid,
        );

        Log::shouldHaveReceived('info')->with('User created', [
            'user_id' => $user->id,
            'uuid' => $user->uuid,
        ]);

        $user->delete();

        Log::shouldHaveReceived('info')->with('User deleted', [
            'user_id' => $user->id,
            'uuid' => $user->uuid,
        ]);
    }

    public function test_lazy_loading_prevention_is_enabled_outside_production(): void
    {
        $this->assertTrue(Model::preventsLazyLoading());
    }
}

class ActiveScopeTestModel extends Model
{
    protected $table = 'active_scope_test_models';

    protected $guarded = [];

    protected static function booted(): void
    {
        static::addGlobalScope(new ActiveScope);
    }
}
