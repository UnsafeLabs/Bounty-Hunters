<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Tests\TestCase;

class UserObserverTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_observer_generates_uuid_and_logs_lifecycle_events(): void
    {
        Log::spy();

        $user = User::create([
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.com',
            'password' => 'password',
        ]);

        $this->assertTrue(Str::isUuid($user->uuid));
        Log::shouldHaveReceived('info')
            ->with('User created', \Mockery::on(fn (array $context): bool => (
                $context['user_id'] === $user->getKey()
                && $context['uuid'] === $user->uuid
                && $context['email'] === 'ada@example.com'
            )))
            ->once();

        $user->delete();

        Log::shouldHaveReceived('info')
            ->with('User deleted', \Mockery::on(fn (array $context): bool => (
                $context['user_id'] === $user->getKey()
                && $context['uuid'] === $user->uuid
                && $context['email'] === 'ada@example.com'
            )))
            ->once();
    }
}
