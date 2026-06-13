<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AuditLoggingTest extends TestCase
{
    use RefreshDatabase;

    public function test_creating_user_writes_audit_log_without_sensitive_values(): void
    {
        $user = User::factory()->create([
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.test',
            'password' => Hash::make('secret-password'),
        ]);

        $log = AuditLog::query()->where('event', 'created')->firstOrFail();

        $this->assertSame(User::class, $log->auditable_type);
        $this->assertSame($user->id, $log->auditable_id);
        $this->assertNull($log->old_values);
        $this->assertSame('Ada Lovelace', $log->new_values['name']);
        $this->assertSame('ada@example.test', $log->new_values['email']);
        $this->assertArrayNotHasKey('password', $log->new_values);
        $this->assertArrayNotHasKey('remember_token', $log->new_values);
    }

    public function test_updating_user_writes_old_and_new_values_with_actor_and_request_metadata(): void
    {
        $actor = User::factory()->create();
        $user = User::factory()->create([
            'name' => 'Audit Target',
            'email' => 'audit-target@example.test',
        ]);
        AuditLog::query()->delete();

        $request = Request::create('/audit-test/users/'.$user->id, 'PUT', [], [], [], [
            'REMOTE_ADDR' => '203.0.113.10',
            'HTTP_USER_AGENT' => 'AuditTest/1.0',
        ]);
        $this->app->instance('request', $request);

        $this->actingAs($actor);

        $user->update(['name' => 'Grace Hopper']);

        $log = AuditLog::query()->where('event', 'updated')->firstOrFail();

        $this->assertSame($actor->id, $log->user_id);
        $this->assertSame('203.0.113.10', $log->ip_address);
        $this->assertSame('AuditTest/1.0', $log->user_agent);
        $this->assertSame('Audit Target', $log->old_values['name']);
        $this->assertSame('Grace Hopper', $log->new_values['name']);
        $this->assertArrayNotHasKey('email', $log->old_values);
        $this->assertArrayNotHasKey('password', $log->old_values);
        $this->assertArrayNotHasKey('password', $log->new_values);
    }

    public function test_deleting_user_writes_old_values_and_history_is_reverse_chronological(): void
    {
        $user = User::factory()->create(['name' => 'Delete Me']);
        AuditLog::query()->delete();

        $user->update(['name' => 'Delete Me Later']);
        $user->delete();

        $deletedLog = AuditLog::query()->where('event', 'deleted')->firstOrFail();

        $this->assertSame('Delete Me Later', $deletedLog->old_values['name']);
        $this->assertNull($deletedLog->new_values);
        $this->assertArrayNotHasKey('password', $deletedLog->old_values);

        $history = $user->getAuditHistory();

        $this->assertSame(['deleted', 'updated'], $history->pluck('event')->all());
    }
}
