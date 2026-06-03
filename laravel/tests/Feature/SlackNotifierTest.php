<?php

namespace Tests\Feature;

use Tests\TestCase;
use Illuminate\Support\Facades\Http;
use App\Services\SlackNotifier;
use Exception;

class SlackNotifierTest extends TestCase
{
    public function test_throws_exception_if_webhook_url_not_configured()
    {
        config(['services.slack.webhook_url' => '']);
        
        $this->expectException(Exception::class);
        $this->expectExceptionMessage('Slack webhook URL is not configured.');
        
        (new SlackNotifier())->send('test');
    }

    public function test_payload_structure_and_channel_override()
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.com/services/test',
            'services.slack.default_channel' => '#default',
        ]);

        $called = false;
        Http::fake(function ($request) use (&$called) {
            $called = true;
            $data = $request->data();
            
            $this->assertEquals('Hello Slack', $data['text']);
            $this->assertEquals('#override', $data['channel']);
            $this->assertEquals([['color' => 'good', 'text' => 'Attachment']], $data['attachments']);
            
            return Http::response('ok', 200);
        });

        $notifier = new SlackNotifier();
        $result = $notifier->send('Hello Slack', '#override', [['color' => 'good', 'text' => 'Attachment']]);
        
        $this->assertTrue($result);
        $this->assertTrue($called);
    }

    public function test_default_channel_is_used_when_none_provided()
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.com/services/test',
            'services.slack.default_channel' => '#default',
        ]);

        $called = false;
        Http::fake(function ($request) use (&$called) {
            $called = true;
            $data = $request->data();
            
            $this->assertEquals('Hello Slack', $data['text']);
            $this->assertEquals('#default', $data['channel']);
            $this->assertArrayNotHasKey('attachments', $data);
            
            return Http::response('ok', 200);
        });

        $notifier = new SlackNotifier();
        $result = $notifier->send('Hello Slack');
        
        $this->assertTrue($result);
        $this->assertTrue($called);
    }

    public function test_no_channel_in_payload_if_not_configured_and_not_provided()
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.com/services/test',
            'services.slack.default_channel' => null,
        ]);

        $called = false;
        Http::fake(function ($request) use (&$called) {
            $called = true;
            $data = $request->data();
            
            $this->assertEquals('Hello Slack', $data['text']);
            $this->assertArrayNotHasKey('channel', $data);
            
            return Http::response('ok', 200);
        });

        $notifier = new SlackNotifier();
        $result = $notifier->send('Hello Slack');
        
        $this->assertTrue($result);
        $this->assertTrue($called);
    }

    public function test_static_calling()
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.com/services/test',
            'services.slack.default_channel' => '#default',
        ]);

        Http::fake();

        $result = SlackNotifier::send('Hello Slack');
        
        $this->assertTrue($result);
        Http::assertSent(function ($request) {
            return $request->data()['text'] === 'Hello Slack';
        });
    }

    public function test_timeout_is_5_seconds()
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.com/services/test',
            'services.slack.default_channel' => '#default',
        ]);

        $timeout = null;
        Http::fake(function ($request, $options) use (&$timeout) {
            $timeout = $options['timeout'] ?? null;
            return Http::response('ok', 200);
        });

        $notifier = new SlackNotifier();
        $notifier->send('test');

        $this->assertEquals(5, $timeout);
    }

    public function test_5xx_error_retries_once_and_succeeds()
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.com/services/test',
            'services.slack.default_channel' => '#default',
        ]);

        Http::fake([
            '*' => Http::sequence()
                ->push('error', 500)
                ->push('ok', 200),
        ]);

        $notifier = new SlackNotifier();
        $result = $notifier->send('test');

        $this->assertTrue($result);
        Http::assertSentCount(2);
    }

    public function test_5xx_error_retries_once_and_fails_throwing_exception()
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.com/services/test',
            'services.slack.default_channel' => '#default',
        ]);

        Http::fake([
            '*' => Http::sequence()
                ->push('error', 500)
                ->push('error', 500),
        ]);

        $notifier = new SlackNotifier();

        $this->expectException(Exception::class);
        $this->expectExceptionMessage('Slack notification failed after retry. Status: 500');

        try {
            $notifier->send('test');
        } finally {
            Http::assertSentCount(2);
        }
    }

    public function test_4xx_error_throws_immediately_without_retrying()
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.com/services/test',
            'services.slack.default_channel' => '#default',
        ]);

        Http::fake([
            '*' => Http::sequence()
                ->push('error', 400)
                ->push('ok', 200),
        ]);

        $notifier = new SlackNotifier();

        $this->expectException(Exception::class);
        $this->expectExceptionMessage('Slack notification failed with a client error. Status: 400');

        try {
            $notifier->send('test');
        } finally {
            Http::assertSentCount(1);
        }
    }
}
