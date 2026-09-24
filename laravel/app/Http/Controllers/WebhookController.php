<?php

namespace App\Http\Controllers;

use App\Models\Webhook;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class WebhookController extends Controller
{
    /**
     * List every registered webhook.
     */
    public function index(): JsonResponse
    {
        return response()->json(Webhook::query()->latest()->get());
    }

    /**
     * Register a new webhook.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validatePayload($request);

        $webhook = Webhook::create([
            'url' => $data['url'],
            'secret' => $data['secret'] ?? Str::random(40),
            'events' => $data['events'],
            'active' => $data['active'] ?? true,
        ]);

        return response()->json($webhook, 201);
    }

    /**
     * Show a single webhook.
     */
    public function show(Webhook $webhook): JsonResponse
    {
        return response()->json($webhook);
    }

    /**
     * Update an existing webhook.
     */
    public function update(Request $request, Webhook $webhook): JsonResponse
    {
        $data = $this->validatePayload($request, partial: true);

        $webhook->fill($data)->save();

        return response()->json($webhook);
    }

    /**
     * Delete a webhook and its delivery history.
     */
    public function destroy(Webhook $webhook): JsonResponse
    {
        $webhook->delete();

        return response()->json(null, 204);
    }

    /**
     * Validate the incoming webhook payload.
     *
     * @return array<string, mixed>
     */
    protected function validatePayload(Request $request, bool $partial = false): array
    {
        $required = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'url' => [$required, 'url'],
            'secret' => ['sometimes', 'string', 'min:8'],
            'events' => [$required, 'array', 'min:1'],
            'events.*' => ['string', 'max:255'],
            'active' => ['sometimes', 'boolean'],
        ]);
    }
}
