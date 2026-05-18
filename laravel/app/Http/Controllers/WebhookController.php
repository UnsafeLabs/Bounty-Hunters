<?php

namespace App\Http\Controllers;

use App\Models\Webhook;
use App\Services\WebhookDispatcher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class WebhookController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([
            'webhooks' => Webhook::with('deliveries')->get(),
        ]);
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
            'secret' => Str::random(32),
            'events' => $validated['events'],
            'active' => $validated['active'] ?? true,
        ]);

        return response()->json([
            'message' => 'Webhook created',
            'webhook' => $webhook,
        ], 201);
    }

    public function update(Request $request, Webhook $webhook): JsonResponse
    {
        $validated = $request->validate([
            'url' => 'url',
            'events' => 'array',
            'events.*' => 'string',
            'active' => 'boolean',
        ]);

        $webhook->update($validated);

        return response()->json([
            'message' => 'Webhook updated',
            'webhook' => $webhook->fresh(),
        ]);
    }

    public function destroy(Webhook $webhook): JsonResponse
    {
        $webhook->delete();

        return response()->json(['message' => 'Webhook deleted']);
    }

    public function deliveries(Webhook $webhook): JsonResponse
    {
        return response()->json([
            'deliveries' => $webhook->deliveries()->orderBy('created_at', 'desc')->paginate(25),
        ]);
    }
}
