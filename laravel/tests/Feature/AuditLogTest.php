<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuditLogTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_create_update_and_delete_are_audited(): void
    {
        $user = User::factory()->create(['name' => 'Alice']);
        $this->assertSame('created', AuditLog::first()->event);
        $this->assertSame('Alice', AuditLog::first()->new_values['name']);
        $this->assertArrayNotHasKey('password', AuditLog::first()->new_values);

        $user->update(['name' => 'Bob']);
        $updated = AuditLog::where('event', 'updated')->first();
        $this->assertSame('Alice', $updated->old_values['name']);
        $this->assertSame('Bob', $updated->new_values['name']);

        $user->delete();
        $this->assertDatabaseHas('audit_logs', ['event' => 'deleted']);
        $this->assertCount(3, $user->getAuditHistory());
    }
}
