<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuditLoggingTest extends TestCase
{
    use RefreshDatabase;

    public function test_creating_user_generates_audit_log_without_sensitive_values(): void
    {
        $user = User::factory()->create([
            'name' => 'Ada',
            'email' => 'ada@example.com',
            'password' => 'secret-password',
        ]);

        $log = AuditLog::query()->sole();

        $this->assertSame(User::class, $log->auditable_type);
        $this->assertSame((string) $user->getKey(), $log->auditable_id);
        $this->assertSame('created', $log->event);
        $this->assertSame([], $log->old_values);
        $this->assertSame('Ada', $log->new_values['name']);
        $this->assertSame('ada@example.com', $log->new_values['email']);
        $this->assertArrayNotHasKey('password', $log->new_values);
    }

    public function test_updating_user_generates_audit_log_with_changed_old_and_new_values(): void
    {
        $user = User::factory()->create(['name' => 'Before']);
        AuditLog::query()->delete();

        $user->update(['name' => 'After']);

        $log = AuditLog::query()->sole();

        $this->assertSame('updated', $log->event);
        $this->assertSame(['name' => 'Before'], $log->old_values);
        $this->assertSame(['name' => 'After'], $log->new_values);
    }

    public function test_deleting_user_generates_audit_log_with_old_values(): void
    {
        $user = User::factory()->create([
            'name' => 'Grace',
            'email' => 'grace@example.com',
        ]);
        AuditLog::query()->delete();

        $user->delete();

        $log = AuditLog::query()->sole();

        $this->assertSame('deleted', $log->event);
        $this->assertSame('Grace', $log->old_values['name']);
        $this->assertSame('grace@example.com', $log->old_values['email']);
        $this->assertSame([], $log->new_values);
    }

    public function test_audit_history_is_reverse_chronological_and_includes_authenticated_metadata(): void
    {
        $actor = User::withoutEvents(fn () => User::factory()->create());

        $this->actingAs($actor);
        $this->app['request']->server->set('REMOTE_ADDR', '203.0.113.10');
        $this->app['request']->headers->set('User-Agent', 'AuditTest/1.0');

        $user = User::factory()->create(['name' => 'First']);
        $user->update(['name' => 'Second']);

        $history = $user->getAuditHistory();

        $this->assertSame(['updated', 'created'], $history->pluck('event')->all());
        $this->assertTrue($history->every(fn (AuditLog $log) => $log->user_id === $actor->id));
        $this->assertTrue($history->every(fn (AuditLog $log) => $log->ip_address === '203.0.113.10'));
        $this->assertTrue($history->every(fn (AuditLog $log) => $log->user_agent === 'AuditTest/1.0'));
    }
}
