<?php

namespace App\Http\Controllers;

use App\Models\Webhook;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;

class WebhookController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(Webhook::query()->latest()->get());
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'url' => ['required', 'url', 'max:2048'],
            'secret' => ['sometimes', 'string', 'min:16', 'max:255'],
            'events' => ['required', 'array', 'min:1'],
            'events.*' => ['required', 'string', 'max:255'],
            'active' => ['sometimes', 'boolean'],
        ]);

        $webhook = Webhook::query()->create([
            ...$validated,
            'secret' => $validated['secret'] ?? Str::random(64),
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
            'url' => ['sometimes', 'url', 'max:2048'],
            'secret' => ['sometimes', 'string', 'min:16', 'max:255'],
            'events' => ['sometimes', 'array', 'min:1'],
            'events.*' => ['required_with:events', 'string', 'max:255'],
            'active' => ['sometimes', 'boolean'],
        ]);

        $webhook->update($validated);

        return response()->json($webhook->refresh());
    }

    public function destroy(Webhook $webhook): Response
    {
        $webhook->delete();

        return response()->noContent();
    }
}
