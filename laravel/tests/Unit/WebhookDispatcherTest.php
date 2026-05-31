<?php

namespace Tests\Unit;

use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Services\WebhookDispatcher;
use Carbon\CarbonImmutable;
use Tests\TestCase;

class WebhookDispatcherTest extends TestCase
{
    public function test_it_generates_hmac_sha256_signature_for_json_body(): void
    {
        $webhook = new Webhook(['secret' => 'top-secret']);
        $body = [
            'event' => 'user.created',
            'payload' => ['id' => 123, 'email' => 'dom@example.test'],
        ];

        $expectedBody = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $expectedSignature = 'sha256='.hash_hmac('sha256', $expectedBody, 'top-secret');

        $this->assertSame($expectedSignature, app(WebhookDispatcher::class)->signature($webhook, $body));
    }

    public function test_it_calculates_exponential_retry_timing(): void
    {
        $dispatcher = app(WebhookDispatcher::class);
        $now = CarbonImmutable::parse('2026-05-31 09:00:00');

        $this->assertSame([60, 120, 240, 480, 960], WebhookDispatcher::backoffSchedule());
        $this->assertSame(60, $dispatcher->retryDelayForAttempt(1));
        $this->assertSame(240, $dispatcher->retryDelayForAttempt(3));
        $this->assertTrue($now->addSeconds(240)->equalTo($dispatcher->nextRetryAtForAttempt(3, $now)));
        $this->assertNull($dispatcher->nextRetryAtForAttempt(5, $now));
    }

    public function test_it_builds_delivery_body_from_event_and_payload(): void
    {
        $delivery = new WebhookDelivery([
            'event' => 'invoice.paid',
            'payload' => ['invoice_id' => 99],
        ]);

        $this->assertSame([
            'event' => 'invoice.paid',
            'payload' => ['invoice_id' => 99],
        ], app(WebhookDispatcher::class)->deliveryBody($delivery));
    }
}
