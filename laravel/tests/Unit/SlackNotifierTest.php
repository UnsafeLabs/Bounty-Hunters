<?php

namespace Tests\Unit;

use App\Services\SlackNotifier;
use Illuminate\Http\Client\Request;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;
use Tests\TestCase;

class SlackNotifierTest extends TestCase
{
    public function test_slack_notifier_sends_expected_payload(): void
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.test/services/test',
            'services.slack.default_channel' => '#alerts',
        ]);
        $blocks = [
            [
                'type' => 'section',
                'text' => [
                    'type' => 'mrkdwn',
                    'text' => '*Deploy finished*',
                ],
            ],
        ];

        Http::fake([
            'hooks.slack.test/*' => Http::response(['ok' => true]),
        ]);

        SlackNotifier::send('Deploy finished', blocks: $blocks);

        Http::assertSent(function (Request $request): bool {
            return $request->url() === 'https://hooks.slack.test/services/test'
                && $request->method() === 'POST'
                && $request['text'] === 'Deploy finished'
                && $request['channel'] === '#alerts'
                && $request['blocks'][0]['type'] === 'section';
        });
    }

    public function test_channel_override_replaces_default_channel(): void
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.test/services/test',
            'services.slack.default_channel' => '#alerts',
        ]);
        Http::fake([
            'hooks.slack.test/*' => Http::response(['ok' => true]),
        ]);

        app(SlackNotifier::class)->notify('Payment received', '#payments');

        Http::assertSent(fn (Request $request): bool => $request['channel'] === '#payments');
    }

    public function test_server_error_retries_once_before_succeeding(): void
    {
        config(['services.slack.webhook_url' => 'https://hooks.slack.test/services/test']);
        Http::fake([
            'hooks.slack.test/*' => Http::sequence()
                ->push(['ok' => false], 500)
                ->push(['ok' => true], 200),
        ]);

        SlackNotifier::send('Retry me');

        Http::assertSentCount(2);
    }

    public function test_server_error_throws_after_one_retry(): void
    {
        config(['services.slack.webhook_url' => 'https://hooks.slack.test/services/test']);
        Http::fake([
            'hooks.slack.test/*' => Http::sequence()
                ->push(['ok' => false], 500)
                ->push(['ok' => false], 503),
        ]);

        try {
            SlackNotifier::send('Still failing');

            $this->fail('Expected Slack notification to throw after a retry.');
        } catch (RequestException) {
            Http::assertSentCount(2);
        }
    }

    public function test_client_error_throws_without_retrying(): void
    {
        config(['services.slack.webhook_url' => 'https://hooks.slack.test/services/test']);
        Http::fake([
            'hooks.slack.test/*' => Http::response(['ok' => false], 400),
        ]);

        try {
            SlackNotifier::send('Bad request');

            $this->fail('Expected Slack notification to throw immediately.');
        } catch (RequestException) {
            Http::assertSentCount(1);
        }
    }

    public function test_missing_webhook_url_throws(): void
    {
        config(['services.slack.webhook_url' => null]);

        $this->expectException(InvalidArgumentException::class);

        SlackNotifier::send('No webhook');
    }
}
