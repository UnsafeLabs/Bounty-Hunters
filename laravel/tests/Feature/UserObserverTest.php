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

    public function test_uuid_is_generated_before_user_creation(): void
    {
        $user = User::factory()->create();

        $this->assertNotNull($user->uuid);
        $this->assertTrue(Str::isUuid($user->uuid));
        $this->assertDatabaseHas('users', ['id' => $user->id, 'uuid' => $user->uuid]);
    }

    public function test_existing_uuid_is_not_overwritten(): void
    {
        $uuid = (string) Str::uuid();

        $user = User::factory()->create(['uuid' => $uuid]);

        $this->assertSame($uuid, $user->uuid);
    }

    public function test_observer_logs_creation_and_deletion_events(): void
    {
        Log::spy();

        $user = User::factory()->create();
        $user->delete();

        Log::shouldHaveReceived('info')->with('User created', \Mockery::any())->once();
        Log::shouldHaveReceived('info')->with('User deleting', \Mockery::any())->once();
    }
}
