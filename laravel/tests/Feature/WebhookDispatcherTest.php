<?php

namespace Tests\Feature;

use App\Jobs\DispatchWebhookJob;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Services\WebhookDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Tests\TestCase;

class WebhookDispatcherTest extends TestCase
{
    use RefreshDatabase;

    private function webhook(): Webhook
    {
        return Webhook::create([
            'url' => 'https://example.test/hook',
            'secret' => 'top-secret',
            'events' => ['order.created'],
            'active' => true,
        ]);
    }

    public function test_queue_creates_a_delivery_and_dispatches_the_job(): void
    {
        Queue::fake();
        $webhook = $this->webhook();

        $delivery = (new WebhookDispatcher())->queue($webhook, 'order.created', ['id' => 1]);

        $this->assertDatabaseHas('webhook_deliveries', [
            'id' => $delivery->id,
            'webhook_id' => $webhook->id,
            'event' => 'order.created',
            'attempts' => 0,
        ]);

        Queue::assertPushed(DispatchWebhookJob::class, function (DispatchWebhookJob $job) use ($delivery) {
            return $job->deliveryId === $delivery->id;
        });
    }

    public function test_successful_delivery_is_signed_and_recorded(): void
    {
        Http::fake(['*' => Http::response('ok', 200)]);
        $webhook = $this->webhook();

        $delivery = $webhook->deliveries()->create([
            'event' => 'order.created',
            'payload' => ['id' => 1],
            'attempts' => 0,
        ]);

        (new WebhookDispatcher())->send($delivery->load('webhook'));

        $delivery->refresh();
        $this->assertSame(200, $delivery->response_code);
        $this->assertSame(1, $delivery->attempts);
        $this->assertNotNull($delivery->delivered_at);
        $this->assertNull($delivery->next_retry_at);

        $expected = hash_hmac(
            'sha256',
            json_encode(['event' => 'order.created', 'payload' => ['id' => 1]], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES),
            'top-secret'
        );

        Http::assertSent(function ($request) use ($expected) {
            return $request->hasHeader(WebhookDispatcher::SIGNATURE_HEADER, $expected);
        });
    }

    public function test_failed_delivery_records_attempt_and_schedules_retry(): void
    {
        $this->freezeTime();
        Http::fake(['*' => Http::response('boom', 500)]);
        $webhook = $this->webhook();

        $delivery = $webhook->deliveries()->create([
            'event' => 'order.created',
            'payload' => ['id' => 1],
            'attempts' => 0,
        ]);

        try {
            (new WebhookDispatcher())->send($delivery->load('webhook'));
            $this->fail('Expected a RuntimeException on failed delivery.');
        } catch (RuntimeException $e) {
            // expected — surfaces the failure so the queue retries
        }

        $delivery->refresh();
        $this->assertSame(500, $delivery->response_code);
        $this->assertSame(1, $delivery->attempts);
        $this->assertNull($delivery->delivered_at);
        $this->assertNotNull($delivery->next_retry_at);
        $this->assertSame(
            now()->addSeconds(DispatchWebhookJob::backoffFor(1))->timestamp,
            $delivery->next_retry_at->timestamp
        );
    }

    public function test_no_retry_is_scheduled_after_the_final_attempt(): void
    {
        Http::fake(['*' => Http::response('boom', 500)]);
        $webhook = $this->webhook();

        $delivery = $webhook->deliveries()->create([
            'event' => 'order.created',
            'payload' => ['id' => 1],
            'attempts' => DispatchWebhookJob::MAX_ATTEMPTS - 1,
        ]);

        try {
            (new WebhookDispatcher())->send($delivery->load('webhook'));
        } catch (RuntimeException $e) {
            // expected
        }

        $delivery->refresh();
        $this->assertSame(DispatchWebhookJob::MAX_ATTEMPTS, $delivery->attempts);
        $this->assertNull($delivery->next_retry_at);
    }

    public function test_network_exception_is_recorded_as_a_failed_attempt(): void
    {
        Http::fake(function () {
            throw new \Illuminate\Http\Client\ConnectionException('no route to host');
        });
        $webhook = $this->webhook();

        $delivery = $webhook->deliveries()->create([
            'event' => 'order.created',
            'payload' => ['id' => 1],
            'attempts' => 0,
        ]);

        try {
            (new WebhookDispatcher())->send($delivery->load('webhook'));
        } catch (RuntimeException $e) {
            // expected
        }

        $delivery->refresh();
        $this->assertNull($delivery->response_code);
        $this->assertSame(1, $delivery->attempts);
        $this->assertNotNull($delivery->next_retry_at);
    }
}
