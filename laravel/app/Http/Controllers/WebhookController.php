<?php

namespace App\Http\Controllers;

use App\Models\Webhook;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WebhookController extends Controller
{
    /**
     * List all webhooks.
     */
    public function index(): JsonResponse
    {
        return response()->json(Webhook::all());
    }

    /**
     * Create a new webhook.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'url' => 'required|url',
            'secret' => 'required|string|min:16',
            'events' => 'required|array',
            'events.*' => 'string',
        ]);

        $webhook = Webhook::create($validated);

        return response()->json($webhook, 201);
    }

    /**
     * Show a webhook with recent deliveries.
     */
    public function show(Webhook $webhook): JsonResponse
    {
        return response()->json(
            $webhook->load(['deliveries' => fn ($q) => $q->latest()->limit(20)])
        );
    }

    /**
     * Update a webhook.
     */
    public function update(Request $request, Webhook $webhook): JsonResponse
    {
        $validated = $request->validate([
            'url' => 'sometimes|url',
            'secret' => 'sometimes|string|min:16',
            'events' => 'sometimes|array',
            'events.*' => 'string',
            'active' => 'sometimes|boolean',
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
}
