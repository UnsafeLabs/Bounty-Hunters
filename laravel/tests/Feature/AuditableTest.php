<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AuditableTest extends TestCase
{
    use RefreshDatabase;

    public function test_creating_a_user_generates_a_created_audit_log(): void
    {
        $user = User::factory()->create();

        $log = AuditLog::query()
            ->where('auditable_type', User::class)
            ->where('auditable_id', $user->id)
            ->where('event', 'created')
            ->sole();

        $this->assertSame($user->name, $log->new_values['name']);
        $this->assertSame($user->email, $log->new_values['email']);
        $this->assertNull($log->old_values);
    }

    public function test_updating_a_user_logs_old_and_new_values(): void
    {
        $user = User::factory()->create(['name' => 'Original Name']);

        $user->name = 'Updated Name';
        $user->save();

        $log = AuditLog::query()
            ->where('auditable_id', $user->id)
            ->where('event', 'updated')
            ->sole();

        $this->assertSame('Original Name', $log->old_values['name']);
        $this->assertSame('Updated Name', $log->new_values['name']);
    }

    public function test_deleting_a_user_logs_old_values(): void
    {
        $user = User::factory()->create();
        $userId = $user->id;
        $name = $user->name;

        $user->delete();

        $log = AuditLog::query()
            ->where('auditable_id', $userId)
            ->where('event', 'deleted')
            ->sole();

        $this->assertSame($name, $log->old_values['name']);
        $this->assertNull($log->new_values);
    }

    public function test_sensitive_fields_are_excluded_from_audit_values(): void
    {
        $user = User::factory()->create();

        $user->name = 'Renamed';
        $user->password = Hash::make('brand-new-secret');
        $user->save();

        $created = AuditLog::query()->where('event', 'created')->sole();
        $updated = AuditLog::query()->where('event', 'updated')->sole();

        $this->assertArrayNotHasKey('password', $created->new_values);
        $this->assertArrayNotHasKey('remember_token', $created->new_values);
        $this->assertArrayHasKey('name', $updated->new_values);
        $this->assertArrayNotHasKey('password', $updated->new_values);
        $this->assertArrayNotHasKey('password', $updated->old_values);
    }

    public function test_get_audit_history_is_in_reverse_chronological_order(): void
    {
        $user = User::factory()->create();

        $user->name = 'First Update';
        $user->save();

        $user->name = 'Second Update';
        $user->save();

        $history = $user->getAuditHistory();

        $this->assertCount(3, $history);
        $this->assertSame('updated', $history->first()->event);
        $this->assertSame('created', $history->last()->event);
    }

    public function test_audit_log_records_the_authenticated_user_id(): void
    {
        $actor = User::factory()->create();

        $this->actingAs($actor);

        $target = User::factory()->create();

        $log = AuditLog::query()
            ->where('auditable_id', $target->id)
            ->where('event', 'created')
            ->sole();

        $this->assertSame($actor->id, $log->user_id);
    }
}
