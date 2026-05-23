<?php

namespace Tests\Unit;

use App\Services\SlackNotifier;
use Illuminate\Http\Client\Request;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SlackNotifierTest extends TestCase
{
    public function test_it_sends_slack_payload_with_channel_and_blocks(): void
    {
        Http::fake([
            'https://hooks.slack.test/*' => Http::response(['ok' => true]),
        ]);
        config([
            'services.slack.webhook_url' => 'https://hooks.slack.test/services/one',
            'services.slack.default_channel' => '#ops',
        ]);

        SlackNotifier::send('Deploy finished', blocks: [
            ['type' => 'section', 'text' => ['type' => 'mrkdwn', 'text' => 'Done']],
        ]);

        Http::assertSent(function (Request $request) {
            return $request->url() === 'https://hooks.slack.test/services/one'
                && $request['text'] === 'Deploy finished'
                && $request['channel'] === '#ops'
                && $request['blocks'][0]['type'] === 'section';
        });
    }

    public function test_it_retries_once_on_server_error(): void
    {
        Http::fakeSequence()
            ->pushStatus(500)
            ->push(['ok' => true], 200);
        config(['services.slack.webhook_url' => 'https://hooks.slack.test/services/one']);

        SlackNotifier::send('Retry me');

        Http::assertSentCount(2);
    }

    public function test_it_does_not_retry_client_errors(): void
    {
        Http::fake([
            'https://hooks.slack.test/*' => Http::response(['error' => 'bad'], 400),
        ]);
        config(['services.slack.webhook_url' => 'https://hooks.slack.test/services/one']);

        $this->expectException(RequestException::class);

        SlackNotifier::send('Fail fast');
    }
}
