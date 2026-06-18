<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AuditLoggingTest extends TestCase
{
    use RefreshDatabase;

    public function test_creating_user_generates_audit_log_without_sensitive_fields(): void
    {
        $user = User::factory()->create([
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.test',
            'password' => Hash::make('secret-password'),
        ]);

        $log = AuditLog::query()->where('event', 'created')->firstOrFail();

        $this->assertSame(User::class, $log->auditable_type);
        $this->assertSame($user->id, $log->auditable_id);
        $this->assertSame('Ada Lovelace', $log->new_values['name']);
        $this->assertSame('ada@example.test', $log->new_values['email']);
        $this->assertArrayNotHasKey('password', $log->new_values);
        $this->assertSame([], $log->old_values);
    }

    public function test_updating_user_records_old_and_new_changed_values(): void
    {
        $user = User::factory()->create(['name' => 'Before']);
        AuditLog::query()->delete();

        $user->update(['name' => 'After']);

        $log = AuditLog::query()->where('event', 'updated')->firstOrFail();

        $this->assertSame('Before', $log->old_values['name']);
        $this->assertSame('After', $log->new_values['name']);
        $this->assertArrayNotHasKey('password', $log->old_values);
        $this->assertArrayNotHasKey('password', $log->new_values);
    }

    public function test_deleting_user_records_old_values(): void
    {
        $user = User::factory()->create([
            'name' => 'Delete Me',
            'email' => 'delete@example.test',
        ]);
        AuditLog::query()->delete();

        $user->delete();

        $log = AuditLog::query()->where('event', 'deleted')->firstOrFail();

        $this->assertSame('Delete Me', $log->old_values['name']);
        $this->assertSame('delete@example.test', $log->old_values['email']);
        $this->assertSame([], $log->new_values);
        $this->assertArrayNotHasKey('password', $log->old_values);
    }

    public function test_audit_logs_include_authenticated_user_and_request_metadata(): void
    {
        config(['app.key' => 'base64:'.base64_encode(str_repeat('a', 32))]);

        $actor = User::factory()->create();
        AuditLog::query()->delete();

        $this->actingAs($actor)
            ->withHeader('User-Agent', 'AuditTest/1.0')
            ->get('/');

        User::factory()->create();

        $log = AuditLog::query()->where('event', 'created')->firstOrFail();

        $this->assertSame($actor->id, $log->user_id);
        $this->assertSame('127.0.0.1', $log->ip_address);
        $this->assertSame('AuditTest/1.0', $log->user_agent);
    }

    public function test_get_audit_history_returns_reverse_chronological_logs(): void
    {
        $user = User::factory()->create(['name' => 'One']);
        $user->update(['name' => 'Two']);
        $user->update(['name' => 'Three']);

        $history = $user->getAuditHistory();

        $this->assertGreaterThanOrEqual(3, $history->count());
        $this->assertSame(['updated', 'updated', 'created'], $history->take(3)->pluck('event')->all());
    }
}
