<?php

namespace Tests\Feature;

use App\Models\User;
use App\Scopes\ActiveScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Mockery;
use Tests\TestCase;

class EloquentInfrastructureTest extends TestCase
{
    use RefreshDatabase;

    public function test_active_scope_filters_active_records_and_can_be_removed(): void
    {
        Schema::create('active_scope_records', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->boolean('active')->default(true);
        });

        ActiveScopeRecord::query()->create(['name' => 'Visible', 'active' => true]);
        ActiveScopeRecord::withoutGlobalScope(ActiveScope::class)->create([
            'name' => 'Hidden',
            'active' => false,
        ]);

        $this->assertSame(['Visible'], ActiveScopeRecord::query()->pluck('name')->all());
        $this->assertSame(
            ['Hidden', 'Visible'],
            ActiveScopeRecord::withoutGlobalScope(ActiveScope::class)->orderBy('name')->pluck('name')->all(),
        );
    }

    public function test_user_observer_generates_uuid_and_logs_lifecycle_events(): void
    {
        Log::spy();

        $user = User::factory()->create();

        $this->assertNotEmpty($user->uuid);
        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'uuid' => $user->uuid,
        ]);

        $user->delete();

        Log::shouldHaveReceived('info')
            ->with('User created', Mockery::on(fn (array $context) => $context['uuid'] === $user->uuid))
            ->once();
        Log::shouldHaveReceived('info')
            ->with('User deleted', Mockery::on(fn (array $context) => $context['uuid'] === $user->uuid))
            ->once();
    }

    public function test_lazy_loading_is_prevented_in_testing_environment(): void
    {
        $this->assertTrue(Model::preventsLazyLoading());
    }
}

class ActiveScopeRecord extends Model
{
    protected $table = 'active_scope_records';

    public $timestamps = false;

    protected $guarded = [];

    protected static function booted(): void
    {
        static::addGlobalScope(new ActiveScope());
    }
}
