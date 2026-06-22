<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\AuditLog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuditLogTest extends TestCase
{
    use RefreshDatabase;

    public function test_creating_user_generates_audit_log()
    {
        $user = User::factory()->create(["active" => 1]);
        $logs = $user->getAuditHistory();
        $this->assertGreaterThan(0, $logs->count());
        $this->assertEquals("created", $logs->first()->event);
    }

    public function test_updating_user_generates_audit_log()
    {
        $user = User::factory()->create(["active" => 1]);
        $user->update(["name" => "New Name"]);
        $logs = $user->getAuditHistory();
        $updatedLogs = $logs->where("event", "updated");
        $this->assertGreaterThan(0, $updatedLogs->count());
    }

    public function test_deleting_user_generates_audit_log()
    {
        $user = User::factory()->create(["active" => 1]);
        $userId = $user->id;
        $user->delete();
        $auditLog = AuditLog::where("auditable_id", $userId)
            ->where("event", "deleted")
            ->first();
        $this->assertNotNull($auditLog);
    }

    public function test_password_excluded_from_audit()
    {
        $user = User::factory()->create(["active" => 1]);
        $user->update(["name" => "Test"]);
        $log = $user->getAuditHistory()->where("event", "updated")->first();
        $newValues = $log->new_values;
        $this->assertArrayNotHasKey("password", $newValues);
    }

    public function test_audit_history_is_reverse_chronological()
    {
        $user = User::factory()->create(["active" => 1]);
        $user->update(["name" => "A"]);
        $user->update(["name" => "B"]);
        $history = $user->getAuditHistory();
        $dates = $history->pluck("created_at");
        for ($i = 0; $i < $dates->count() - 1; $i++) {
            $this->assertGreaterThanOrEqual($dates[$i + 1], $dates[$i]);
        }
    }
}
