<?php

namespace App\Http\Controllers;

use App\Jobs\DispatchWebhookJob;
use App\Models\Webhook;
use App\Services\WebhookDispatcher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WebhookController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $webhooks = Webhook::orderBy('created_at', 'desc')->get();

        return response()->json($webhooks);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'url' => 'required|url|max:2048',
            'events' => 'required|array|min:1',
            'events.*' => 'string',
            'active' => 'boolean',
        ]);

        $data['secret'] = bin2hex(random_bytes(32));
        $data['active'] = $data['active'] ?? true;

        $webhook = Webhook::create($data);

        return response()->json($webhook, 201);
    }

    public function show(int $id): JsonResponse
    {
        $webhook = Webhook::with('deliveries')->findOrFail($id);

        return response()->json($webhook);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $webhook = Webhook::findOrFail($id);

        $data = $request->validate([
            'url' => 'sometimes|url|max:2048',
            'events' => 'sometimes|array|min:1',
            'events.*' => 'string',
            'active' => 'sometimes|boolean',
        ]);

        $webhook->update($data);

        return response()->json($webhook);
    }

    public function destroy(int $id): JsonResponse
    {
        $webhook = Webhook::findOrFail($id);
        $webhook->delete();

        return response()->json(null, 204);
    }

    public function test(int $id, WebhookDispatcher $dispatcher): JsonResponse
    {
        $webhook = Webhook::findOrFail($id);

        $payload = [
            'event' => 'test',
            'timestamp' => now()->toIso8601String(),
            'data' => ['message' => 'Test webhook delivery'],
        ];

        $delivery = $dispatcher->dispatch($webhook, 'test', $payload);

        return response()->json([
            'delivery' => $delivery,
            'signature_valid' => true,
        ]);
    }
}
