<?php

namespace Tests\Feature;

use App\Services\SlackNotifier;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;
use Tests\TestCase;

class SlackNotifierTest extends TestCase
{
    private const WEBHOOK_URL = 'https://hooks.slack.test/services/T000/B000/secret';

    protected function setUp(): void
    {
        parent::setUp();

        Config::set('services.slack.webhook_url', self::WEBHOOK_URL);
        Config::set('services.slack.default_channel', '#alerts');
    }

    public function test_it_sends_slack_payload_with_default_channel_and_blocks(): void
    {
        Http::fake([
            self::WEBHOOK_URL => Http::response('ok'),
        ]);

        SlackNotifier::send('Deploy complete', blocks: [
            ['type' => 'section', 'text' => ['type' => 'mrkdwn', 'text' => 'Done']],
        ]);

        Http::assertSent(function ($request) {
            return $request->url() === self::WEBHOOK_URL
                && $request['text'] === 'Deploy complete'
                && $request['channel'] === '#alerts'
                && $request['blocks'][0]['type'] === 'section';
        });
    }

    public function test_channel_override_replaces_default_channel(): void
    {
        Http::fake([
            self::WEBHOOK_URL => Http::response('ok'),
        ]);

        SlackNotifier::send('Incident opened', '#incidents');

        Http::assertSent(fn ($request) => $request['channel'] === '#incidents');
    }

    public function test_server_errors_are_retried_once(): void
    {
        Http::fakeSequence()
            ->push('temporary failure', 500)
            ->push('ok', 200);

        SlackNotifier::send('Retry me');

        Http::assertSentCount(2);
    }

    public function test_client_errors_throw_without_retry(): void
    {
        Http::fake([
            self::WEBHOOK_URL => Http::response('bad request', 400),
        ]);

        try {
            SlackNotifier::send('Do not retry');
            $this->fail('Expected Slack client error to throw.');
        } catch (RequestException) {
            Http::assertSentCount(1);
        }
    }

    public function test_missing_webhook_url_throws_configuration_error(): void
    {
        Config::set('services.slack.webhook_url', null);

        $this->expectException(InvalidArgumentException::class);

        SlackNotifier::send('Missing config');
    }
}
