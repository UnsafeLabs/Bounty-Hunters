<?php

namespace Tests\Unit;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;
use Tests\TestCase;

class UserObserverScopeTest extends TestCase
{
    public function test_user_observer_generates_uuid_on_create(): void
    {
        $user = User::factory()->create(['uuid' => null]);

        $this->assertTrue(Str::isUuid($user->uuid));
    }

    public function test_lazy_loading_prevention_is_enabled_in_testing(): void
    {
        $this->assertTrue(Model::preventsLazyLoading());
    }
}
