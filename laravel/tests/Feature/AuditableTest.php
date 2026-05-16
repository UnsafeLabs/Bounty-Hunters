<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuditableTest extends TestCase
{
    use RefreshDatabase;

    public function test_creating_a_user_generates_an_audit_log(): void
    {
        request()->server->set('REMOTE_ADDR', '203.0.113.10');
        request()->headers->set('User-Agent', 'AuditTest/1.0');

        $user = User::factory()->create([
            'name' => 'Created User',
            'email' => 'created@example.com',
            'password' => 'secret-password',
            'remember_token' => 'remember-me',
        ]);

        $auditLog = AuditLog::query()->sole();

        $this->assertSame(User::class, $auditLog->auditable_type);
        $this->assertSame($user->id, $auditLog->auditable_id);
        $this->assertSame('created', $auditLog->event);
        $this->assertSame([], $auditLog->old_values);
        $this->assertSame('Created User', $auditLog->new_values['name']);
        $this->assertSame('created@example.com', $auditLog->new_values['email']);
        $this->assertArrayNotHasKey('password', $auditLog->new_values);
        $this->assertArrayNotHasKey('remember_token', $auditLog->new_values);
        $this->assertSame('203.0.113.10', $auditLog->ip_address);
        $this->assertSame('AuditTest/1.0', $auditLog->user_agent);
    }

    public function test_updating_a_user_generates_an_audit_log_with_changed_values(): void
    {
        $user = User::factory()->create([
            'name' => 'Original User',
            'email' => 'original@example.com',
        ]);

        AuditLog::query()->delete();

        $user->update([
            'name' => 'Updated User',
            'email' => 'updated@example.com',
        ]);

        $auditLog = AuditLog::query()->sole();

        $this->assertSame('updated', $auditLog->event);
        $this->assertSame('Original User', $auditLog->old_values['name']);
        $this->assertSame('original@example.com', $auditLog->old_values['email']);
        $this->assertSame('Updated User', $auditLog->new_values['name']);
        $this->assertSame('updated@example.com', $auditLog->new_values['email']);
        $this->assertArrayNotHasKey('password', $auditLog->old_values);
        $this->assertArrayNotHasKey('password', $auditLog->new_values);
    }

    public function test_deleting_a_user_generates_an_audit_log_with_old_values(): void
    {
        $user = User::factory()->create([
            'name' => 'Deleted User',
            'email' => 'deleted@example.com',
            'password' => 'secret-password',
        ]);

        AuditLog::query()->delete();

        $user->delete();

        $auditLog = AuditLog::query()->sole();

        $this->assertSame('deleted', $auditLog->event);
        $this->assertSame('Deleted User', $auditLog->old_values['name']);
        $this->assertSame('deleted@example.com', $auditLog->old_values['email']);
        $this->assertSame([], $auditLog->new_values);
        $this->assertArrayNotHasKey('password', $auditLog->old_values);
    }

    public function test_get_audit_history_returns_latest_logs_first(): void
    {
        $user = User::factory()->create();

        $user->update(['name' => 'First Update']);
        $user->update(['name' => 'Second Update']);

        $history = $user->getAuditHistory();

        $this->assertSame(['updated', 'updated', 'created'], $history->pluck('event')->all());
        $this->assertSame('Second Update', $history->first()->new_values['name']);
    }

    public function test_audit_log_includes_authenticated_user_id(): void
    {
        $actor = User::factory()->create();

        AuditLog::query()->delete();

        $this->actingAs($actor);

        User::factory()->create();

        $this->assertSame($actor->id, AuditLog::query()->sole()->user_id);
    }
}
