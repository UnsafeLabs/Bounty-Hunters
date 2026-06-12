<?php

namespace App\Http\Controllers;

use App\Models\Webhook;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WebhookController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(Webhook::all());
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'url' => 'required|url',
            'secret' => 'required|string|min:16',
            'events' => 'required|array',
            'events.*' => 'string',
            'active' => 'boolean',
        ]);

        return response()->json(Webhook::create($validated), 201);
    }

    public function show(Webhook $webhook): JsonResponse
    {
        return response()->json($webhook->load('deliveries'));
    }

    public function update(Request $request, Webhook $webhook): JsonResponse
    {
        $validated = $request->validate([
            'url' => 'url',
            'secret' => 'string|min:16',
            'events' => 'array',
            'events.*' => 'string',
            'active' => 'boolean',
        ]);

        $webhook->update($validated);

        return response()->json($webhook);
    }

    public function destroy(Webhook $webhook): JsonResponse
    {
        $webhook->delete();

        return response()->json(null, 204);
    }
}
