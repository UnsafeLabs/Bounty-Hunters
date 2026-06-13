<?php

namespace Tests\Feature;

use App\Services\SlackNotifier;
use Illuminate\Http\Client\Request;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SlackNotifierTest extends TestCase
{
    public function test_sends_slack_payload_with_configured_default_channel(): void
    {
        Config::set('services.slack.webhook_url', 'https://hooks.slack.test/services/default');
        Config::set('services.slack.default_channel', '#alerts');
        Http::fake([
            'hooks.slack.test/*' => Http::response(['ok' => true], 200),
        ]);

        SlackNotifier::send('Build finished');

        Http::assertSent(function (Request $request): bool {
            return $request->url() === 'https://hooks.slack.test/services/default'
                && $request['text'] === 'Build finished'
                && $request['channel'] === '#alerts';
        });
    }

    public function test_channel_override_and_blocks_are_included(): void
    {
        Config::set('services.slack.webhook_url', 'https://hooks.slack.test/services/default');
        Config::set('services.slack.default_channel', '#alerts');
        Http::fake([
            'hooks.slack.test/*' => Http::response(['ok' => true], 200),
        ]);

        SlackNotifier::send(
            'Deployment failed',
            '#deployments',
            [['type' => 'section', 'text' => ['type' => 'mrkdwn', 'text' => '*Failed*']]],
        );

        Http::assertSent(function (Request $request): bool {
            return $request['channel'] === '#deployments'
                && $request['blocks'][0]['type'] === 'section';
        });
    }

    public function test_retries_once_on_server_error(): void
    {
        Config::set('services.slack.webhook_url', 'https://hooks.slack.test/services/default');
        Http::fakeSequence()
            ->push(['ok' => false], 500)
            ->push(['ok' => true], 200);

        SlackNotifier::send('Retry me');

        Http::assertSentCount(2);
    }

    public function test_client_error_throws_without_retry(): void
    {
        Config::set('services.slack.webhook_url', 'https://hooks.slack.test/services/default');
        Http::fakeSequence()->push(['ok' => false], 400);

        $this->expectException(RequestException::class);

        try {
            SlackNotifier::send('Do not retry');
        } finally {
            Http::assertSentCount(1);
        }
    }
}
