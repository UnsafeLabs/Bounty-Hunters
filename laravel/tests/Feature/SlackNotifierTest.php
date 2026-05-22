<?php

namespace Tests\Feature;

use App\Services\SlackNotifier;
use Illuminate\Http\Client\Request;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;
use Tests\TestCase;

class SlackNotifierTest extends TestCase
{
    public function test_it_sends_a_slack_webhook_payload_from_config(): void
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.test/services/default',
            'services.slack.default_channel' => '#alerts',
        ]);
        Http::fake([
            'hooks.slack.test/*' => Http::response(['ok' => true], 200),
        ]);

        SlackNotifier::send('Deploy complete');

        Http::assertSent(function (Request $request): bool {
            return $request->url() === 'https://hooks.slack.test/services/default'
                && $request['text'] === 'Deploy complete'
                && $request['channel'] === '#alerts';
        });
    }

    public function test_channel_override_and_blocks_are_sent_when_provided(): void
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.test/services/override',
            'services.slack.default_channel' => '#alerts',
        ]);
        Http::fake([
            'hooks.slack.test/*' => Http::response(['ok' => true], 200),
        ]);

        SlackNotifier::send('Build failed', '#deploys', [
            [
                'type' => 'section',
                'text' => [
                    'type' => 'mrkdwn',
                    'text' => '*Build failed*',
                ],
            ],
        ]);

        Http::assertSent(function (Request $request): bool {
            return $request['channel'] === '#deploys'
                && $request['blocks'][0]['type'] === 'section'
                && $request['blocks'][0]['text']['text'] === '*Build failed*';
        });
    }

    public function test_server_errors_are_retried_once_before_succeeding(): void
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.test/services/retry',
            'services.slack.default_channel' => '#alerts',
        ]);
        Http::fake([
            'hooks.slack.test/*' => Http::sequence()
                ->push(['error' => 'temporary'], 500)
                ->push(['ok' => true], 200),
        ]);

        $response = SlackNotifier::send('Retry me');

        $this->assertTrue($response->successful());
        Http::assertSentCount(2);
    }

    public function test_client_errors_throw_without_retrying(): void
    {
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.test/services/client-error',
            'services.slack.default_channel' => '#alerts',
        ]);
        Http::fake([
            'hooks.slack.test/*' => Http::response(['error' => 'bad request'], 400),
        ]);

        $this->expectException(RequestException::class);

        try {
            SlackNotifier::send('Bad request');
        } finally {
            Http::assertSentCount(1);
        }
    }

    public function test_missing_webhook_url_throws_configuration_exception(): void
    {
        config([
            'services.slack.webhook_url' => null,
            'services.slack.default_channel' => '#alerts',
        ]);

        $this->expectException(InvalidArgumentException::class);

        SlackNotifier::send('No webhook configured');
    }
}
