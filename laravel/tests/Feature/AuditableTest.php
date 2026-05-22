<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuditableTest extends TestCase
{
    use RefreshDatabase;

    public function test_creating_a_user_writes_an_audit_log_without_sensitive_values(): void
    {
        $actor = User::withoutEvents(fn () => User::factory()->create());

        $this->actingAs($actor);
        request()->server->set('REMOTE_ADDR', '203.0.113.10');
        request()->headers->set('User-Agent', 'AuditTest/1.0');

        $user = User::factory()->create([
            'name' => 'Audited User',
            'email' => 'audited@example.com',
        ]);

        $log = AuditLog::query()->first();

        $this->assertNotNull($log);
        $this->assertSame(User::class, $log->auditable_type);
        $this->assertSame($user->id, $log->auditable_id);
        $this->assertSame('created', $log->event);
        $this->assertSame([], $log->old_values);
        $this->assertSame('Audited User', $log->new_values['name']);
        $this->assertSame('audited@example.com', $log->new_values['email']);
        $this->assertArrayNotHasKey('password', $log->new_values);
        $this->assertArrayNotHasKey('remember_token', $log->new_values);
        $this->assertSame($actor->id, $log->user_id);
        $this->assertSame('203.0.113.10', $log->ip_address);
        $this->assertSame('AuditTest/1.0', $log->user_agent);
    }

    public function test_updating_a_user_writes_old_and_new_changed_values(): void
    {
        $user = User::factory()->create([
            'name' => 'Old Name',
            'email' => 'old@example.com',
        ]);
        AuditLog::query()->delete();

        $user->update([
            'name' => 'New Name',
            'password' => 'new-password',
        ]);

        $log = AuditLog::query()->first();

        $this->assertNotNull($log);
        $this->assertSame('updated', $log->event);
        $this->assertSame(['name' => 'Old Name'], $log->old_values);
        $this->assertSame(['name' => 'New Name'], $log->new_values);
        $this->assertArrayNotHasKey('password', $log->old_values);
        $this->assertArrayNotHasKey('password', $log->new_values);
    }

    public function test_deleting_a_user_writes_an_audit_log_with_old_values(): void
    {
        $user = User::factory()->create([
            'name' => 'Deleted User',
            'email' => 'deleted@example.com',
        ]);
        AuditLog::query()->delete();

        $user->delete();

        $log = AuditLog::query()->first();

        $this->assertNotNull($log);
        $this->assertSame('deleted', $log->event);
        $this->assertSame('Deleted User', $log->old_values['name']);
        $this->assertSame('deleted@example.com', $log->old_values['email']);
        $this->assertSame([], $log->new_values);
        $this->assertArrayNotHasKey('password', $log->old_values);
    }

    public function test_get_audit_history_returns_logs_in_reverse_chronological_order(): void
    {
        $user = User::factory()->create(['name' => 'First Name']);
        $user->update(['name' => 'Second Name']);
        $user->update(['name' => 'Third Name']);

        $history = $user->getAuditHistory();

        $this->assertCount(3, $history);
        $this->assertSame('updated', $history[0]->event);
        $this->assertSame(['name' => 'Third Name'], $history[0]->new_values);
        $this->assertGreaterThan($history[1]->id, $history[0]->id);
        $this->assertSame('created', $history[2]->event);
    }
}
