<?php

namespace Tests\Feature;

use App\Services\SlackNotifier;
use Illuminate\Http\Client\Request;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SlackNotifierTest extends TestCase
{
    public function test_slack_notifier_sends_default_channel_payload(): void
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.test/services/default',
            'services.slack.default_channel' => '#ops',
        ]);

        Http::fake([
            'https://hooks.slack.test/*' => Http::response('ok', 200),
        ]);

        SlackNotifier::send('Deploy complete');

        Http::assertSent(function (Request $request): bool {
            return $request->url() === 'https://hooks.slack.test/services/default'
                && $request['text'] === 'Deploy complete'
                && $request['channel'] === '#ops';
        });
    }

    public function test_slack_notifier_accepts_channel_override_and_blocks(): void
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.test/services/override',
            'services.slack.default_channel' => '#ops',
        ]);

        Http::fake([
            'https://hooks.slack.test/*' => Http::response('ok', 200),
        ]);

        $blocks = [
            [
                'type' => 'section',
                'text' => [
                    'type' => 'mrkdwn',
                    'text' => '*Build passed*',
                ],
            ],
        ];

        SlackNotifier::send('Build passed', '#deploys', $blocks);

        Http::assertSent(function (Request $request) use ($blocks): bool {
            return $request['text'] === 'Build passed'
                && $request['channel'] === '#deploys'
                && $request['blocks'] === $blocks;
        });
    }

    public function test_slack_notifier_retries_once_on_server_errors(): void
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.test/services/retry',
        ]);

        Http::fake([
            'https://hooks.slack.test/*' => Http::sequence()
                ->push('server error', 500)
                ->push('ok', 200),
        ]);

        SlackNotifier::send('Retry once');

        Http::assertSentCount(2);
    }

    public function test_slack_notifier_throws_immediately_on_client_errors(): void
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.test/services/client-error',
        ]);

        Http::fake([
            'https://hooks.slack.test/*' => Http::response('bad request', 400),
        ]);

        try {
            SlackNotifier::send('Do not retry');
            $this->fail('Expected SlackNotifier to throw for a client error.');
        } catch (RequestException) {
            Http::assertSentCount(1);
        }
    }
}
