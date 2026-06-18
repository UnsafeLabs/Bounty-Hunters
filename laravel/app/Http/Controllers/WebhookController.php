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
        return response()->json(Webhook::query()->latest()->get());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $data['secret'] ??= Str::random(40);
        $data['active'] ??= true;

        $webhook = Webhook::query()->create($data);

        return response()->json($webhook, 201);
    }

    public function show(Webhook $webhook): JsonResponse
    {
        return response()->json($webhook->load('deliveries'));
    }

    public function update(Request $request, Webhook $webhook): JsonResponse
    {
        $webhook->update($this->validated($request, true));

        return response()->json($webhook->refresh());
    }

    public function destroy(Webhook $webhook): JsonResponse
    {
        $webhook->delete();

        return response()->json(null, 204);
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, bool $partial = false): array
    {
        $required = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'url' => [$required, 'url'],
            'secret' => ['sometimes', 'nullable', 'string', 'min:8'],
            'events' => [$required, 'array', 'min:1'],
            'events.*' => ['string', 'max:120'],
            'active' => ['sometimes', 'boolean'],
        ]);
    }
}
