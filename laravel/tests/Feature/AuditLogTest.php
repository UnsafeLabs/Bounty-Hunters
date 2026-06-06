<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
        $user->update(['name' => 'Bob']);

        $log = AuditLog::query()->where('event', 'updated')->latest()->firstOrFail();

        $this->assertSame('Alice', $log->old_values['name']);
        $this->assertSame('Bob', $log->new_values['name']);
    }

    public function test_deleting_user_generates_old_values(): void
    {
        $user = User::factory()->create(['name' => 'Alice']);
        $user->delete();

        $log = AuditLog::query()->where('event', 'deleted')->firstOrFail();

        $this->assertSame('Alice', $log->old_values['name']);
        $this->assertSame([], $log->new_values);
    }

    public function test_audit_history_is_reverse_chronological(): void
    {
        $user = User::factory()->create(['name' => 'Alice']);
        $user->update(['name' => 'Bob']);

        $history = $user->getAuditHistory();

        $this->assertSame('updated', $history->first()->event);
        $this->assertSame('created', $history->last()->event);
    }
}
