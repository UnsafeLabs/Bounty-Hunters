<?php

namespace App\Http\Controllers;

use App\Models\Webhook;
use App\Services\WebhookDispatcher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WebhookController extends Controller
{
    public function __construct(
        protected WebhookDispatcher $dispatcher
    ) {}

    /**
     * List all webhooks.
     */
    public function index(): JsonResponse
    {
        $webhooks = Webhook::withCount('deliveries')->get();
        return response()->json($webhooks);
    }

    /**
     * Create a new webhook.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'url' => 'required|url',
            'secret' => 'required|min:16',
            'events' => 'required|array|min:1',
            'active' => 'boolean',
        ]);

        $webhook = Webhook::create([
            'url' => $validated['url'],
            'secret' => $validated['secret'],
            'events' => $validated['events'],
            'active' => $validated['active'] ?? true,
        ]);

        return response()->json($webhook, 201);
    }

    /**
     * Show a specific webhook.
     */
    public function show(Webhook $webhook): JsonResponse
    {
        return response()->json($webhook->loadCount('deliveries'));
    }

    /**
     * Update a webhook.
     */
    public function update(Request $request, Webhook $webhook): JsonResponse
    {
        $validated = $request->validate([
            'url' => 'sometimes|url',
            'secret' => 'sometimes|min:16',
            'events' => 'sometimes|array|min:1',
            'active' => 'boolean',
        ]);

        $webhook->update($validated);

        return response()->json($webhook);
    }

    /**
     * Delete a webhook.
     */
    public function destroy(Webhook $webhook): JsonResponse
    {
        $webhook->delete();
        return response()->json(['message' => 'Webhook deleted']);
    }

    /**
     * Handle incoming webhook payload (for receiving webhooks).
     */
    public function receive(Request $request, string $event): JsonResponse
    {
        $payload = $request->all();
        $signature = $request->header('X-Webhook-Signature');
        $timestamp = (int) $request->header('X-Webhook-Timestamp', 0);

        // Find active webhooks for this event
        $webhooks = Webhook::where('active', true)
            ->whereJsonContains('events', $event)
            ->get();

        foreach ($webhooks as $webhook) {
            if ($this->dispatcher->verifySignature(
                $webhook->secret,
                $payload,
                $signature,
                $timestamp
            )) {
                // Process the verified webhook
                Log::info("Received verified webhook", [
                    'event' => $event,
                    'webhook_id' => $webhook->id,
                ]);
            }
        }

        return response()->json(['received' => true]);
    }
}
