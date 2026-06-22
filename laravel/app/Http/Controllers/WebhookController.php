<?php

namespace App\Http\Controllers;

use App\Models\Webhook;
use App\Services\WebhookDispatcher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WebhookController extends Controller
{
    public function __construct(
        private WebhookDispatcher $dispatcher
    ) {
    }

    public function index(): JsonResponse
    {
        $webhooks = Webhook::orderBy('created_at', 'desc')->get();
        return response()->json($webhooks);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'url' => 'required|url',
            'events' => 'required|array',
            'events.*' => 'string',
            'active' => 'boolean',
        ]);

        $webhook = Webhook::create([
            'url' => $validated['url'],
            'secret' => bin2hex(random_bytes(32)),
            'events' => $validated['events'],
            'active' => $validated['active'] ?? true,
        ]);

        return response()->json($webhook, 201);
    }

    public function show(Webhook $webhook): JsonResponse
    {
        return response()->json($webhook->load('deliveries'));
    }

    public function update(Request $request, Webhook $webhook): JsonResponse
    {
        $validated = $request->validate([
            'url' => 'sometimes|url',
            'events' => 'sometimes|array',
            'active' => 'sometimes|boolean',
        ]);

        $webhook->update($validated);
        return response()->json($webhook);
    }

    public function destroy(Webhook $webhook): JsonResponse
    {
        $webhook->delete();
        return response()->json(['message' => 'Webhook deleted']);
    }

    public function test(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'webhook_id' => 'required|exists:webhooks,id',
            'event' => 'required|string',
            'payload' => 'required|array',
        ]);

        $webhook = Webhook::findOrFail($validated['webhook_id']);
        $this->dispatcher->dispatch($webhook, $validated['event'], $validated['payload']);

        return response()->json(['message' => 'Test webhook dispatched']);
    }
}
