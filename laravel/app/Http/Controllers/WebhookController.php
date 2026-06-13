<?php

namespace App\Http\Controllers;

use App\Models\Webhook;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WebhookController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(Webhook::query()->latest()->paginate(20));
    }

    public function store(Request $request): JsonResponse
    {
        $webhook = Webhook::create($this->validated($request));

        return response()->json($webhook, 201);
    }

    public function update(Request $request, Webhook $webhook): JsonResponse
    {
        $webhook->update($this->validated($request, required: false));

        return response()->json($webhook->fresh());
    }

    public function destroy(Webhook $webhook): JsonResponse
    {
        $webhook->delete();

        return response()->json(null, 204);
    }

    /**
     * @return array{url?: string, secret?: string, events?: list<string>, active?: bool}
     */
    private function validated(Request $request, bool $required = true): array
    {
        $presence = $required ? 'required' : 'sometimes';

        return $request->validate([
            'url' => [$presence, 'url', 'max:2048'],
            'secret' => [$presence, 'string', 'min:16', 'max:255'],
            'events' => [$presence, 'array', 'min:1'],
            'events.*' => ['string', 'max:120'],
            'active' => ['sometimes', 'boolean'],
        ]);
    }
}
