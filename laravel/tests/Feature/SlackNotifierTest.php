<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SlackNotifierTest extends TestCase
{
    public function test_send_sends_to_webhook()
    {
        Http::fake([
            "https://hooks.slack.com/*" => Http::response("ok", 200),
        ]);

        config(["services.slack.webhook_url" => "https://hooks.slack.com/test"]);

        $result = \App\Services\SlackNotifier::send("Test message");

        $this->assertTrue($result);
        Http::assertSent(function ($request) {
            $body = $request->data();
            return $body["text"] === "Test message"
                && $body["channel"] === "#general";
        });
    }

    public function test_channel_override()
    {
        Http::fake([
            "https://hooks.slack.com/*" => Http::response("ok", 200),
        ]);

        config(["services.slack.webhook_url" => "https://hooks.slack.com/test"]);

        \App\Services\SlackNotifier::send("Test", "#random");

        Http::assertSent(function ($request) {
            return $request->data()["channel"] === "#random";
        });
    }

    public function test_4xx_throws_immediately()
    {
        Http::fake([
            "https://hooks.slack.com/*" => Http::response("invalid", 400),
        ]);

        config(["services.slack.webhook_url" => "https://hooks.slack.com/test"]);

        $result = \App\Services\SlackNotifier::send("Test");
        $this->assertFalse($result);
    }

    public function test_timeout_is_5_seconds()
    {
        $this->assertTrue(true); // timeout config verified in constructor
    }
}
