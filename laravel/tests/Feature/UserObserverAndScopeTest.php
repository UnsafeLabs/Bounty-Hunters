<?php

namespace Tests\Feature;

use App\Models\User;
use App\Scopes\ActiveScope;
use Illuminate\Database\Eloquent\Attributes\ScopedBy;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class UserObserverAndScopeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Schema::create('active_scope_test_models', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->boolean('active')->default(true);
            $table->timestamps();
        });
    }

    public function test_active_scope_filters_active_records_and_can_be_removed(): void
    {
        ActiveScopeTestModel::create(['name' => 'visible', 'active' => true]);
        ActiveScopeTestModel::create(['name' => 'hidden', 'active' => false]);

        $this->assertSame(['visible'], ActiveScopeTestModel::pluck('name')->all());
        $this->assertEqualsCanonicalizing(
            ['visible', 'hidden'],
            ActiveScopeTestModel::withoutGlobalScope(ActiveScope::class)->pluck('name')->all(),
        );
    }

    public function test_user_observer_assigns_uuid_and_logs_lifecycle_events(): void
    {
        Log::shouldReceive('info')
            ->once()
            ->with('User created.', \Mockery::on(fn (array $context) => Str::isUuid($context['uuid'])));
        Log::shouldReceive('info')
            ->once()
            ->with('User deleted.', \Mockery::on(fn (array $context) => Str::isUuid($context['uuid'])));

        $user = User::create([
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.com',
            'password' => Hash::make('password'),
        ]);

        $this->assertTrue(Str::isUuid($user->uuid));

        $user->delete();
    }

    public function test_prevent_lazy_loading_is_enabled_outside_production(): void
    {
        $this->assertTrue(Model::preventsLazyLoading());
    }
}

#[ScopedBy([ActiveScope::class])]
class ActiveScopeTestModel extends Model
{
    protected $table = 'active_scope_test_models';

    protected $guarded = [];
}
