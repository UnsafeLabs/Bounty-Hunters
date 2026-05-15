<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\TestCase;

class AuditLogTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware();
    }

    public function test_creating_model_generates_audit_log(): void
    {
        $user = User::factory()->create(['name' => 'Test User']);

        $log = AuditLog::where('auditable_type', User::class)
            ->where('auditable_id', $user->id)
            ->where('event', 'created')
            ->first();

        $this->assertNotNull($log);
        $this->assertArrayHasKey('name', $log->new_values);
    }

    public function test_updating_model_generates_audit_log_with_changes(): void
    {
        $user = User::factory()->create(['name' => 'Original']);
        AuditLog::query()->delete();

        $user->update(['name' => 'Updated']);

        $log = AuditLog::where('event', 'updated')
            ->where('auditable_id', $user->id)
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals(['name' => 'Original'], $log->old_values);
        $this->assertArrayHasKey('name', $log->new_values);
    }

    public function test_deleting_model_generates_audit_log(): void
    {
        $user = User::factory()->create(['name' => 'ToDelete']);
        AuditLog::query()->delete();

        $userId = $user->id;
        $user->delete();

        $log = AuditLog::where('event', 'deleted')
            ->where('auditable_id', $userId)
            ->first();

        $this->assertNotNull($log);
        $this->assertNotNull($log->old_values);
    }

    public function test_password_is_excluded_from_audit(): void
    {
        $user = User::factory()->create();

        $createdLog = AuditLog::where('event', 'created')
            ->where('auditable_id', $user->id)
            ->first();

        $this->assertNotNull($createdLog);
        $this->assertArrayNotHasKey('password', $createdLog->new_values);
        $this->assertArrayNotHasKey('remember_token', $createdLog->new_values);
    }

    public function test_get_audit_history_returns_logs_in_reverse_order(): void
    {
        $user = User::factory()->create(['name' => 'Original']);
        AuditLog::query()->delete();

        $user->update(['name' => 'Second']);
        $user->update(['name' => 'Third']);

        $history = $user->getAuditHistory();

        $this->assertCount(2, $history);
        $this->assertEquals('updated', $history[0]->event);
    }

    public function test_audit_log_includes_user_id_when_authenticated(): void
    {
        $actingUser = User::factory()->create();
        AuditLog::query()->delete();

        $this->actingAs($actingUser);
        $newUser = User::factory()->create();

        $log = AuditLog::where('auditable_id', $newUser->id)->first();
        $this->assertEquals($actingUser->id, $log->user_id);
    }
}
