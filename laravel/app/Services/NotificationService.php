<?php

namespace App\Services;

use App\Models\User;
use App\Models\NotificationPreference;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Log;

class NotificationService
{
    protected array $channels = ['mail', 'database', 'slack'];

    public function send(User $user, string $type, array $data, string $channel = null): void
    {
        $channel = $channel ?? $this->resolveChannel($user, $type);
        
        if (!$this->isChannelAllowed($user, $type, $channel)) {
            return;
        }

        match ($channel) {
            'mail' => $this->sendMail($user, $type, $data),
            'database' => $this->sendDatabase($user, $type, $data),
            'slack' => $this->sendSlack($user, $type, $data),
            default => throw new \InvalidArgumentException("Unsupported channel: {$channel}"),
        };
    }

    protected function resolveChannel(User $user, string $type): string
    {
        $pref = NotificationPreference::where('user_id', $user->id)
            ->where('type', $type)
            ->first();
        return $pref?->channel ?? 'mail';
    }

    protected function isChannelAllowed(User $user, string $type, string $channel): bool
    {
        $pref = NotificationPreference::where('user_id', $user->id)
            ->where('type', $type)
            ->first();
        return $pref ? $pref->enabled : true;
    }

    protected function sendMail(User $user, string $type, array $data): void
    {
        try {
            Mail::send('emails.notifications.' . $type, $data, function ($message) use ($user, $type) {
                $message->to($user->email)
                    ->subject(config("notifications.{$type}.subject", 'Notification'));
            });
        } catch (\Exception $e) {
            Log::error("Failed to send mail notification: {$e->getMessage()}");
        }
    }

    protected function sendDatabase(User $user, string $type, array $data): void
    {
        $user->notifications()->create([
            'type' => $type,
            'data' => $data,
            'read' => false,
        ]);
    }

    protected function sendSlack(User $user, string $type, array $data): void
    {
        $webhook = config("notifications.{$type}.slack_webhook");
        if ($webhook) {
            // Dispatch Slack notification job
            \App\Jobs\SendSlackNotification::dispatch($webhook, $data);
        }
    }

    public function getPreferences(User $user): array
    {
        return NotificationPreference::where('user_id', $user->id)
            ->get()
            ->keyBy('type')
            ->toArray();
    }

    public function setPreference(User $user, string $type, string $channel, bool $enabled): void
    {
        NotificationPreference::updateOrCreate(
            ['user_id' => $user->id, 'type' => $type],
            ['channel' => $channel, 'enabled' => $enabled]
        );
    }
}
