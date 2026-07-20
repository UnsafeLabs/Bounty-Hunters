<?php

namespace App\Http\Controllers;

use App\Models\Webhook;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class WebhookController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([
            'data' => Webhook::query()->orderByDesc('id')->get(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'url' => ['required', 'url', 'max:2048'],
            'secret' => ['nullable', 'string', 'max:255'],
            'events' => ['nullable', 'array'],
            'events.*' => ['string'],
            'active' => ['sometimes', 'boolean'],
        ]);

        $webhook = Webhook::create([
            'url' => $validated['url'],
            'secret' => $validated['secret'] ?? Str::random(32),
            'events' => $validated['events'] ?? ['*'],
            'active' => $validated['active'] ?? true,
        ]);

        return response()->json([
            'data' => $webhook->makeVisible('secret'),
            'message' => 'Webhook created',
        ], 201);
    }

    public function show(int $id): JsonResponse
    {
        $webhook = Webhook::query()->findOrFail($id);

        return response()->json(['data' => $webhook]);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $webhook = Webhook::query()->findOrFail($id);

        $validated = $request->validate([
            'url' => ['sometimes', 'url', 'max:2048'],
            'secret' => ['sometimes', 'string', 'max:255'],
            'events' => ['sometimes', 'array'],
            'events.*' => ['string'],
            'active' => ['sometimes', 'boolean'],
        ]);

        $webhook->fill($validated);
        $webhook->save();

        return response()->json([
            'data' => $webhook,
            'message' => 'Webhook updated',
        ]);
    }

    public function destroy(int $id): JsonResponse
    {
        $webhook = Webhook::query()->findOrFail($id);
        $webhook->delete();

        return response()->json([
            'message' => 'Webhook deleted',
        ]);
    }
}
