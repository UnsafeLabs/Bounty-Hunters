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
        $data = $this->validateWebhook($request);

        return response()->json(Webhook::create($data), 201);
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
        $webhook->update($this->validateWebhook($request, partial: true));

        return response()->json($webhook);
    }

    /**
     * Delete a webhook.
     */
    public function destroy(Webhook $webhook): JsonResponse
    {
        $webhook->delete();

        return response()->json(null, 204);
    }

    /**
     * Validate webhook input. When $partial is true (updates) every field is
     * optional but still validated when present.
     *
     * @return array<string, mixed>
     */
    protected function validateWebhook(Request $request, bool $partial = false): array
    {
        $required = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'url' => [$required, 'url'],
            'secret' => [$required, 'string'],
            'events' => [$required, 'array'],
            'events.*' => ['string'],
            'active' => ['boolean'],
        ]);
    }
}
