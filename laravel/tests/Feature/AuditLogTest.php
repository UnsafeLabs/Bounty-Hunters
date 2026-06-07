<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class AuditLogTest extends TestCase
{
    use RefreshDatabase;

    public function test_creating_user_generates_audit_log(): void
    {
        $user = User::factory()->create(['name' => 'Alice']);

        $log = AuditLog::query()->where('event', 'created')->firstOrFail();

        $this->assertSame(User::class, $log->auditable_type);
        $this->assertSame($user->id, $log->auditable_id);
        $this->assertSame('Alice', $log->new_values['name']);
        $this->assertArrayNotHasKey('password', $log->new_values);
    }

    public function test_updating_user_generates_old_and_new_values(): void
    {
        $user = User::factory()->create(['name' => 'Alice']);
        $user->update(['name' => 'Bob', 'password' => 'new-password']);

        $log = AuditLog::query()->where('event', 'updated')->latest()->firstOrFail();

        $this->assertSame('Alice', $log->old_values['name']);
        $this->assertSame('Bob', $log->new_values['name']);
        $this->assertArrayNotHasKey('password', $log->old_values);
        $this->assertArrayNotHasKey('password', $log->new_values);
    }

    public function test_deleting_user_generates_old_values(): void
    {
        $user = User::factory()->create(['name' => 'Alice']);
        $user->delete();

        $log = AuditLog::query()->where('event', 'deleted')->firstOrFail();

        $this->assertSame('Alice', $log->old_values['name']);
        $this->assertSame([], $log->new_values);
        $this->assertArrayNotHasKey('password', $log->old_values);
    }

    public function test_audit_history_is_reverse_chronological(): void
    {
        $user = User::factory()->create(['name' => 'Alice']);
        $user->update(['name' => 'Bob']);

        $history = $user->getAuditHistory();

        $this->assertSame('updated', $history->first()->event);
        $this->assertSame('created', $history->last()->event);
    }

    public function test_audit_log_records_authenticated_user_and_request_metadata(): void
    {
        Route::post('/audit-test-users', function () {
            return response()->json(User::factory()->create(['name' => 'Audited']), 201);
        });

        $actor = User::factory()->create();

        $this->actingAs($actor)
            ->withServerVariables(['REMOTE_ADDR' => '203.0.113.10'])
            ->withHeader('User-Agent', 'AuditTest/1.0')
            ->postJson('/audit-test-users')
            ->assertCreated();

        $auditedUser = User::query()->where('name', 'Audited')->firstOrFail();
        $log = AuditLog::query()
            ->where('auditable_type', User::class)
            ->where('auditable_id', $auditedUser->id)
            ->where('event', 'created')
            ->firstOrFail();

        $this->assertSame($actor->id, $log->user_id);
        $this->assertSame('203.0.113.10', $log->ip_address);
        $this->assertSame('AuditTest/1.0', $log->user_agent);
    }
}
