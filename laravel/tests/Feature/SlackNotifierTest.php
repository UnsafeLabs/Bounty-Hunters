<?php

namespace Tests\Feature;

use App\Services\SlackNotifier;
use Illuminate\Http\Client\Request;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SlackNotifierTest extends TestCase
{
    public function test_it_sends_slack_payload_with_default_channel_and_blocks(): void
    {
        config()->set('services.slack.webhook_url', 'https://hooks.slack.test/services/default');
        config()->set('services.slack.default_channel', '#alerts');

        Http::fake([
            'hooks.slack.test/*' => Http::response('ok'),
        ]);

        SlackNotifier::send('Deploy failed', blocks: [
            ['type' => 'section', 'text' => ['type' => 'mrkdwn', 'text' => '*Deploy failed*']],
        ]);

        Http::assertSent(function (Request $request): bool {
            return $request->url() === 'https://hooks.slack.test/services/default'
                && $request['text'] === 'Deploy failed'
                && $request['channel'] === '#alerts'
                && $request['blocks'][0]['type'] === 'section';
        });
    }

    public function test_channel_override_replaces_default_channel(): void
    {
        config()->set('services.slack.webhook_url', 'https://hooks.slack.test/services/default');
        config()->set('services.slack.default_channel', '#alerts');

        Http::fake([
            'hooks.slack.test/*' => Http::response('ok'),
        ]);

        SlackNotifier::send('Queue recovered', '#ops');

        Http::assertSent(fn (Request $request): bool => $request['channel'] === '#ops');
    }

    public function test_client_uses_five_second_timeout(): void
    {
        $this->assertStringContainsString('Http::timeout(5)', file_get_contents(app_path('Services/SlackNotifier.php')));

        config()->set('services.slack.webhook_url', 'https://hooks.slack.test/services/default');

        Http::fake([
            'hooks.slack.test/*' => Http::response('ok'),
        ]);

        SlackNotifier::send('Timeout check');

        Http::assertSent(fn (Request $request): bool => $request['text'] === 'Timeout check');
    }

    public function test_server_errors_retry_once_before_succeeding(): void
    {
        config()->set('services.slack.webhook_url', 'https://hooks.slack.test/services/default');

        Http::fakeSequence()
            ->push('temporary failure', 500)
            ->push('ok', 200);

        SlackNotifier::send('Retry this');

        Http::assertSentCount(2);
    }

    public function test_client_errors_throw_without_retrying(): void
    {
        config()->set('services.slack.webhook_url', 'https://hooks.slack.test/services/default');

        Http::fake([
            'hooks.slack.test/*' => Http::response('bad request', 400),
        ]);

        $this->expectException(RequestException::class);

        try {
            SlackNotifier::send('Do not retry');
        } finally {
            Http::assertSentCount(1);
        }
    }
}
