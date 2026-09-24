<?php

namespace Tests\Feature;

use App\Jobs\DispatchWebhookJob;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Services\WebhookDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Tests\TestCase;

class WebhookTest extends TestCase
{
    use RefreshDatabase;

    protected function makeWebhook(array $attributes = []): Webhook
    {
        return Webhook::create(array_merge([
            'url' => 'https://example.com/hooks',
            'secret' => 'top-secret',
            'events' => ['user.created'],
            'active' => true,
        ], $attributes));
    }

    public function test_webhooks_can_be_created_and_listed(): void
    {
        $response = $this->postJson('/webhooks', [
            'url' => 'https://example.com/hooks',
            'events' => ['user.created', 'user.deleted'],
        ]);

        $response->assertCreated()
            ->assertJsonPath('url', 'https://example.com/hooks')
            ->assertJsonPath('events', ['user.created', 'user.deleted'])
            ->assertJsonPath('active', true)
            ->assertJsonMissingPath('secret');

        $this->assertDatabaseCount('webhooks', 1);
        $this->assertNotEmpty(Webhook::first()->secret);

        $this->getJson('/webhooks')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonMissingPath('0.secret');
    }

    public function test_webhook_creation_requires_a_url_and_at_least_one_event(): void
    {
        $this->postJson('/webhooks', ['events' => ['user.created']])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('url');

        $this->postJson('/webhooks', ['url' => 'https://example.com/hooks', 'events' => []])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('events');
    }

    public function test_webhooks_can_be_updated_and_deleted(): void
    {
        $webhook = $this->makeWebhook();

        $this->patchJson("/webhooks/{$webhook->id}", ['active' => false])
            ->assertOk()
            ->assertJsonPath('active', false);

        $this->assertFalse($webhook->fresh()->active);

        $this->deleteJson("/webhooks/{$webhook->id}")->assertNoContent();

        $this->assertDatabaseCount('webhooks', 0);
    }

    public function test_successful_delivery_is_recorded_with_response_code_and_signature(): void
    {
        Http::fake(['*' => Http::response('accepted', 200)]);
        $dispatcher = new WebhookDispatcher;
        $webhook = $this->makeWebhook();

        $delivery = $dispatcher->deliver($webhook, 'user.created', ['id' => 1]);

        $this->assertSame(200, $delivery->response_code);
        $this->assertSame(1, $delivery->attempts);
        $this->assertNotNull($delivery->delivered_at);
        $this->assertNull($delivery->next_retry_at);
        $this->assertTrue($delivery->wasSuccessful());

        Http::assertSent(function (ClientRequest $request) use ($webhook, $dispatcher): bool {
            return $request->url() === $webhook->url
                && $request->hasHeader(
                    'X-Webhook-Signature',
                    $dispatcher->signature($request->body(), $webhook->secret)
                );
        });
    }

    public function test_failed_delivery_schedules_an_exponential_retry(): void
    {
        Carbon::setTestNow('2026-01-01 00:00:00');
        Http::fake(['*' => Http::response('nope', 500)]);
        $dispatcher = new WebhookDispatcher;
        $webhook = $this->makeWebhook();

        $delivery = $dispatcher->deliver($webhook, 'user.created', ['id' => 1]);

        $this->assertSame(500, $delivery->response_code);
        $this->assertSame(1, $delivery->attempts);
        $this->assertNull($delivery->delivered_at);
        $this->assertFalse($delivery->wasSuccessful());
        $this->assertTrue($delivery->next_retry_at->equalTo(now()->addSeconds(60)));

        $delivery = $dispatcher->attempt($delivery->fresh());

        $this->assertSame(2, $delivery->attempts);
        $this->assertTrue($delivery->next_retry_at->equalTo(now()->addSeconds(120)));

        Carbon::setTestNow();
    }

    public function test_unreachable_receiver_records_a_null_response_code_and_schedules_retry(): void
    {
        Http::fake(fn () => throw new RuntimeException('connection refused'));
        $dispatcher = new WebhookDispatcher;
        $webhook = $this->makeWebhook();

        $delivery = $dispatcher->deliver($webhook, 'user.created', ['id' => 1]);

        $this->assertNull($delivery->response_code);
        $this->assertSame(1, $delivery->attempts);
        $this->assertNotNull($delivery->next_retry_at);
    }

    public function test_retry_stops_once_the_attempt_budget_is_exhausted(): void
    {
        $dispatcher = new WebhookDispatcher;
        $webhook = $this->makeWebhook();

        $delivery = $webhook->deliveries()->create([
            'event' => 'user.created',
            'payload' => ['id' => 1],
            'attempts' => WebhookDispatcher::MAX_ATTEMPTS,
        ]);

        $this->assertFalse($dispatcher->scheduleRetry($delivery));
        $this->assertNull($delivery->fresh()->next_retry_at);
    }

    public function test_job_is_queued_with_five_attempts_and_exponential_backoff(): void
    {
        Queue::fake();
        $webhook = $this->makeWebhook();

        DispatchWebhookJob::dispatch($webhook->id, 'user.created', ['id' => 1]);

        Queue::assertPushed(DispatchWebhookJob::class);

        $job = new DispatchWebhookJob($webhook->id, 'user.created', ['id' => 1]);

        $this->assertSame(5, $job->tries);
        $this->assertSame([60, 120, 240, 480], $job->backoff());
    }

    public function test_job_delivers_the_event_and_records_the_attempt(): void
    {
        Http::fake(['*' => Http::response('ok', 200)]);
        $webhook = $this->makeWebhook();

        (new DispatchWebhookJob($webhook->id, 'user.created', ['id' => 1]))->handle(new WebhookDispatcher);

        $delivery = WebhookDelivery::sole();

        $this->assertSame('user.created', $delivery->event);
        $this->assertSame(['id' => 1], $delivery->payload);
        $this->assertTrue($delivery->wasSuccessful());
    }

    public function test_job_throws_when_delivery_fails_so_the_queue_retries(): void
    {
        Http::fake(['*' => Http::response('down', 503)]);
        $webhook = $this->makeWebhook();

        $this->expectException(RuntimeException::class);

        (new DispatchWebhookJob($webhook->id, 'user.created', ['id' => 1]))->handle(new WebhookDispatcher);
    }

    public function test_job_skips_inactive_or_deleted_webhooks(): void
    {
        Http::fake();
        $webhook = $this->makeWebhook(['active' => false]);

        (new DispatchWebhookJob($webhook->id, 'user.created', ['id' => 1]))->handle(new WebhookDispatcher);

        $this->assertDatabaseCount('webhook_deliveries', 0);
        Http::assertNothingSent();
    }

    public function test_models_expose_their_relationships_and_event_subscriptions(): void
    {
        $webhook = $this->makeWebhook(['events' => ['user.created', 'user.deleted']]);

        $delivery = $webhook->deliveries()->create([
            'event' => 'user.created',
            'payload' => ['id' => 1],
        ]);

        $this->assertTrue($webhook->deliveries->contains($delivery));
        $this->assertTrue($delivery->webhook->is($webhook));
        $this->assertTrue($webhook->subscribedTo('user.created'));
        $this->assertFalse($webhook->subscribedTo('order.paid'));
        $this->assertTrue($this->makeWebhook(['events' => ['*']])->subscribedTo('anything'));
    }
}
