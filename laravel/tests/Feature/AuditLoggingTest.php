<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuditLoggingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('app.key', 'base64:'.base64_encode(random_bytes(32)));
    }

    public function test_creating_a_user_generates_a_created_audit_log_without_sensitive_fields(): void
    {
        $actor = User::factory()->create();
        $this->actingAs($actor);
        request()->server->set('REMOTE_ADDR', '203.0.113.10');
        request()->headers->set('User-Agent', 'AuditTest/1.0');

        $user = User::factory()->create([
            'name' => 'Audit Target',
            'email' => 'target@example.test',
            'password' => 'super-secret',
        ]);

        $log = AuditLog::query()
            ->where('auditable_type', User::class)
            ->where('auditable_id', $user->id)
            ->where('event', 'created')
            ->firstOrFail();

        $this->assertNull($log->old_values);
        $this->assertSame('Audit Target', $log->new_values['name']);
        $this->assertSame('target@example.test', $log->new_values['email']);
        $this->assertArrayNotHasKey('password', $log->new_values);
        $this->assertSame($actor->id, $log->user_id);
        $this->assertSame('203.0.113.10', $log->ip_address);
        $this->assertSame('AuditTest/1.0', $log->user_agent);
    }

    public function test_updating_a_user_generates_old_and_new_values(): void
    {
        $user = User::factory()->create([
            'name' => 'Old Name',
        ]);

        $user->update([
            'name' => 'New Name',
        ]);

        $log = AuditLog::query()
            ->where('auditable_type', User::class)
            ->where('auditable_id', $user->id)
            ->where('event', 'updated')
            ->latest('id')
            ->firstOrFail();

        $this->assertSame('Old Name', $log->old_values['name']);
        $this->assertSame('New Name', $log->new_values['name']);
        $this->assertArrayNotHasKey('password', $log->old_values);
        $this->assertArrayNotHasKey('password', $log->new_values);
    }

    public function test_deleting_a_user_generates_deleted_log_and_history_is_latest_first(): void
    {
        $user = User::factory()->create([
            'name' => 'Delete Me',
        ]);

        $user->update(['name' => 'Delete Me Later']);
        $user->delete();

        $deletedLog = AuditLog::query()
            ->where('auditable_type', User::class)
            ->where('auditable_id', $user->id)
            ->where('event', 'deleted')
            ->firstOrFail();

        $this->assertSame('Delete Me Later', $deletedLog->old_values['name']);
        $this->assertNull($deletedLog->new_values);

        $history = $user->getAuditHistory();

        $this->assertSame(['deleted', 'updated', 'created'], $history->pluck('event')->all());
    }
}
