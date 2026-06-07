<?php

namespace App\Http\Controllers;

use App\Models\Webhook;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class WebhookController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(Webhook::query()->latest()->paginate());
    }

    public function store(Request $request): JsonResponse
    {
        $webhook = Webhook::query()->create($this->validatePayload($request));

        return response()->json($webhook, 201);
    }

    public function show(Webhook $webhook): JsonResponse
    {
        return response()->json($webhook->load('deliveries'));
    }

    public function update(Request $request, Webhook $webhook): JsonResponse
    {
        $webhook->update($this->validatePayload($request, partial: true));

        return response()->json($webhook->refresh());
    }

    public function destroy(Webhook $webhook): Response
    {
        $webhook->delete();

        return response()->noContent();
    }

    private function validatePayload(Request $request, bool $partial = false): array
    {
        $required = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'url' => [$required, 'url'],
            'secret' => [$required, 'string', 'min:16'],
            'events' => [$required, 'array', 'min:1'],
            'events.*' => ['string'],
            'active' => ['sometimes', 'boolean'],
        ]);
    }
}
