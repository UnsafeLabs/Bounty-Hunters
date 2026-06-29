<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class AuditableTest extends TestCase
{
    use RefreshDatabase;

    public function test_creating_user_writes_created_audit_log_without_sensitive_fields(): void
    {
        $user = User::factory()->create([
            'name' => 'Alice',
            'email' => 'alice@example.com',
            'password' => 'secret',
        ]);

        $log = AuditLog::query()->where('event', 'created')->firstOrFail();

        $this->assertSame(User::class, $log->auditable_type);
        $this->assertSame($user->id, $log->auditable_id);
        $this->assertSame([], $log->old_values);
        $this->assertSame('Alice', $log->new_values['name']);
        $this->assertSame('alice@example.com', $log->new_values['email']);
        $this->assertArrayNotHasKey('password', $log->new_values);
        $this->assertArrayNotHasKey('remember_token', $log->new_values);
    }

    public function test_updating_user_writes_changed_old_and_new_values(): void
    {
        $user = User::factory()->create([
            'name' => 'Before',
            'email' => 'before@example.com',
        ]);

        $user->update([
            'name' => 'After',
        ]);

        $log = AuditLog::query()->where('event', 'updated')->latest()->firstOrFail();

        $this->assertSame(['name' => 'Before'], $log->old_values);
        $this->assertSame(['name' => 'After'], $log->new_values);
    }

    public function test_deleting_user_writes_deleted_log_with_old_values(): void
    {
        $user = User::factory()->create([
            'name' => 'Deleted User',
            'email' => 'deleted@example.com',
        ]);

        $user->delete();

        $log = AuditLog::query()->where('event', 'deleted')->latest()->firstOrFail();

        $this->assertSame($user->id, $log->auditable_id);
        $this->assertSame('Deleted User', $log->old_values['name']);
        $this->assertSame('deleted@example.com', $log->old_values['email']);
        $this->assertSame([], $log->new_values);
    }

    public function test_get_audit_history_returns_logs_newest_first(): void
    {
        $user = User::factory()->create();

        $user->update(['name' => 'First change']);
        $user->update(['name' => 'Second change']);

        $events = $user->getAuditHistory()
            ->pluck('event')
            ->all();

        $this->assertSame(['updated', 'updated', 'created'], $events);
    }

    public function test_audit_logs_include_authenticated_user_and_request_metadata(): void
    {
        $actor = User::factory()->create();

        Route::post('/audit-test-user', function () {
            return User::query()->create([
                'name' => 'Audited',
                'email' => 'audited-'.uniqid().'@example.com',
                'password' => 'password',
            ]);
        });

        $this->actingAs($actor)
            ->withHeader('User-Agent', 'AuditTest/1.0')
            ->post('/audit-test-user');

        $log = AuditLog::query()
            ->where('event', 'created')
            ->where('user_id', $actor->id)
            ->latest()
            ->firstOrFail();

        $this->assertSame($actor->id, $log->user_id);
        $this->assertSame('AuditTest/1.0', $log->user_agent);
        $this->assertNotNull($log->ip_address);
    }
}
