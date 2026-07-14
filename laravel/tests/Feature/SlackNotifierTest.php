<?php

namespace Tests\Feature;

use App\Services\SlackNotifier;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SlackNotifierTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.com/services/test',
            'services.slack.default_channel' => '#test',
        ]);
    }

    public function test_sends_correct_payload(): void
    {
        Http::fake([
            'hooks.slack.com/*' => Http::response(['ok' => true], 200),
        ]);

        $notifier = new SlackNotifier();
        $result = $notifier->send('Hello', '#general');

        $this->assertEquals(['ok' => true], $result);

        Http::assertSent(function ($request) {
            $body = $request->data();
            return $body['channel'] === '#general' && $body['text'] === 'Hello';
        });
    }

    public function test_channel_override_works(): void
    {
        Http::fake([
            'hooks.slack.com/*' => Http::response(['ok' => true], 200),
        ]);

        $notifier = new SlackNotifier();
        $notifier->send('Hello', '#random');

        Http::assertSent(function ($request) {
            return $request->data()['channel'] === '#random';
        });
    }

    public function test_uses_default_channel_when_not_provided(): void
    {
        Http::fake([
            'hooks.slack.com/*' => Http::response(['ok' => true], 200),
        ]);

        $notifier = new SlackNotifier();
        $notifier->send('Hello');

        Http::assertSent(function ($request) {
            return $request->data()['channel'] === '#test';
        });
    }

    public function test_retries_on_5xx(): void
    {
        Http::fake([
            'hooks.slack.com/*' => Http::sequence()
                ->push(['error' => 'server_error'], 503)
                ->push(['ok' => true], 200),
        ]);

        $notifier = new SlackNotifier();
        $result = $notifier->send('Hello');

        $this->assertEquals(['ok' => true], $result);
    }

    public function test_does_not_retry_on_4xx(): void
    {
        Http::fake([
            'hooks.slack.com/*' => Http::response(['error' => 'bad_request'], 400),
        ]);

        $this->expectException(\Illuminate\Http\Client\RequestException::class);

        $notifier = new SlackNotifier();
        $notifier->send('Hello');
    }

    public function test_static_send_message_works(): void
    {
        Http::fake([
            'hooks.slack.com/*' => Http::response(['ok' => true], 200),
        ]);

        $result = SlackNotifier::send('Hello');

        $this->assertEquals(['ok' => true], $result);
    }
}
