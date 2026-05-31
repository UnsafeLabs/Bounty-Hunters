<?php

namespace App\Http\Controllers;

use App\Models\Webhook;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WebhookController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([
            'data' => Webhook::query()
                ->withCount('deliveries')
                ->latest()
                ->get(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $webhook = Webhook::query()->create($this->validateWebhook($request));

        return response()->json([
            'data' => $webhook,
        ], 201);
    }

    public function show(Webhook $webhook): JsonResponse
    {
        return response()->json([
            'data' => $webhook->load('deliveries'),
        ]);
    }

    public function update(Request $request, Webhook $webhook): JsonResponse
    {
        $webhook->update($this->validateWebhook($request, updating: true));

        return response()->json([
            'data' => $webhook->refresh(),
        ]);
    }

    public function destroy(Webhook $webhook): JsonResponse
    {
        $webhook->delete();

        return response()->json(status: 204);
    }

    /**
     * @return array{url?: string, secret?: string, events?: array<int, string>, active?: bool}
     */
    private function validateWebhook(Request $request, bool $updating = false): array
    {
        $required = $updating ? 'sometimes' : 'required';

        $validated = $request->validate([
            'url' => [$required, 'url', 'max:2048'],
            'secret' => [$required, 'string', 'max:255'],
            'events' => [$required, 'array', 'min:1'],
            'events.*' => ['string', 'max:255'],
            'active' => ['sometimes', 'boolean'],
        ]);

        if (! $updating) {
            $validated['active'] ??= true;
        }

        return $validated;
    }
}
