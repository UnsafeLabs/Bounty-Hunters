<?php

namespace Tests\Feature;

use App\Models\User;
use App\Traits\Auditable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuditableTestModel extends Model
{
    use Auditable;

    protected $fillable = ['name', 'value'];
    protected $table = 'test_auditable_models';
}

class AuditableTest extends TestCase
{
    use RefreshDatabase;

    public function test_create_generates_audit_log(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $model = AuditableTestModel::create(['name' => 'test', 'value' => '1']);

        $this->assertDatabaseHas('audit_logs', [
            'auditable_type' => AuditableTestModel::class,
            'auditable_id' => $model->id,
            'event' => 'created',
            'user_id' => $user->id,
        ]);
    }

    public function test_update_generates_audit_log(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $model = AuditableTestModel::create(['name' => 'test', 'value' => '1']);
        $model->update(['value' => '2']);

        $this->assertDatabaseHas('audit_logs', [
            'event' => 'updated',
            'auditable_id' => $model->id,
        ]);
    }

    public function test_delete_generates_audit_log(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $model = AuditableTestModel::create(['name' => 'test', 'value' => '1']);
        $model->delete();

        $this->assertDatabaseHas('audit_logs', [
            'event' => 'deleted',
            'auditable_id' => $model->id,
        ]);
    }

    public function test_get_audit_history(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $model = AuditableTestModel::create(['name' => 'test', 'value' => '1']);
        $model->update(['value' => '2']);

        $history = $model->getAuditHistory();

        $this->assertCount(2, $history);
        $this->assertEquals('updated', $history->first()->event);
    }

    public function test_audit_log_stores_ip_and_user_agent(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $model = AuditableTestModel::create(['name' => 'test', 'value' => '1']);

        $log = $model->auditLogs()->first();
        $this->assertNotNull($log->ip_address);
        $this->assertNotNull($log->user_agent);
    }
}
