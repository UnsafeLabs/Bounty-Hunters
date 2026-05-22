<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuditableTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_creation_generates_audit_log(): void
    {
        $user = User::factory()->create(['name' => 'Test User', 'email' => 'test@example.com']);

        $log = AuditLog::where('auditable_type', User::class)
            ->where('auditable_id', $user->id)
            ->where('event', 'created')
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals('created', $log->event);
        $this->assertNull($log->old_values);
        $this->assertIsArray($log->new_values);
        $this->assertEquals('Test User', $log->new_values['name']);
        $this->assertEquals('test@example.com', $log->new_values['email']);
    }

    public function test_user_update_generates_audit_log_with_old_and_new_values(): void
    {
        $user = User::factory()->create(['name' => 'Old Name']);
        AuditLog::truncate();

        $user->name = 'New Name';
        $user->save();

        $log = AuditLog::where('auditable_type', User::class)
            ->where('auditable_id', $user->id)
            ->where('event', 'updated')
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals('updated', $log->event);
        $this->assertIsArray($log->old_values);
        $this->assertIsArray($log->new_values);
        $this->assertEquals('Old Name', $log->old_values['name']);
        $this->assertEquals('New Name', $log->new_values['name']);
    }

    public function test_user_deletion_generates_audit_log(): void
    {
        $user = User::factory()->create(['name' => 'To Be Deleted']);
        $userId = $user->id;
        AuditLog::truncate();

        $user->delete();

        $log = AuditLog::where('auditable_type', User::class)
            ->where('auditable_id', $userId)
            ->where('event', 'deleted')
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals('deleted', $log->event);
        $this->assertIsArray($log->old_values);
    }

    public function test_sensitive_fields_are_excluded_from_audit_values(): void
    {
        $user = User::factory()->create([
            'name' => 'Test User',
            'email' => 'test@example.com',
            'password' => 'secret-password',
        ]);

        $log = AuditLog::where('auditable_type', User::class)
            ->where('auditable_id', $user->id)
            ->where('event', 'created')
            ->first();

        $this->assertNotNull($log);
        $this->assertArrayNotHasKey('password', $log->new_values);
        $this->assertArrayNotHasKey('remember_token', $log->new_values ?? []);
        $this->assertEquals('Test User', $log->new_values['name']);
    }

    public function test_get_audit_history_returns_logs_in_reverse_chronological_order(): void
    {
        $user = User::factory()->create(['name' => 'History User']);
        AuditLog::truncate();

        $user->name = 'Update 1';
        $user->save();
        $user->name = 'Update 2';
        $user->save();

        $history = $user->getAuditHistory();

        $this->assertCount(2, $history);
        $this->assertEquals('updated', $history->first()->event);
        $this->assertEquals('Update 2', $history->first()->new_values['name']);
    }
}
