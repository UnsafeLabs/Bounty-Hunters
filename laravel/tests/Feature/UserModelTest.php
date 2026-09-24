<?php

namespace Tests\Feature;

use App\Models\User;
use App\Scopes\ActiveScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Tests\TestCase;

class UserModelTest extends TestCase
{
    use RefreshDatabase;

    public function test_active_scope_only_returns_active_records(): void
    {
        User::factory()->create(['email' => 'active@example.com']);
        User::factory()->create(['email' => 'inactive@example.com', 'active' => false]);

        $this->assertSame(1, User::query()->count());
        $this->assertSame('active@example.com', User::query()->sole()->email);
    }

    public function test_active_scope_can_be_opted_out_of(): void
    {
        User::factory()->count(2)->create(['active' => false]);

        $this->assertSame(0, User::query()->count());
        $this->assertSame(2, User::withoutGlobalScope(ActiveScope::class)->count());
    }

    public function test_uuid_is_generated_before_creation(): void
    {
        $user = User::factory()->create();

        $this->assertNotNull($user->uuid);
        $this->assertTrue(Str::isUuid($user->uuid));

        $other = User::factory()->create();

        $this->assertNotSame($user->uuid, $other->uuid);
    }

    public function test_observer_logs_creation_and_deletion(): void
    {
        Log::spy();

        $user = User::factory()->create();

        Log::shouldHaveReceived('info')
            ->withArgs(fn (string $message) => $message === 'User creating')
            ->once();

        $user->delete();

        Log::shouldHaveReceived('info')
            ->withArgs(fn (string $message) => $message === 'User deleting')
            ->once();
    }

    public function test_lazy_loading_prevention_is_enabled_outside_production(): void
    {
        $this->assertFalse(app()->isProduction());
        $this->assertTrue(Model::preventsLazyLoading());
    }
}
