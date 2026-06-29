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
        return response()->json(
            Webhook::query()
                ->latest()
                ->paginate(20)
        );
    }

    public function store(Request $request): JsonResponse
    {
        $webhook = Webhook::query()->create($this->validateWebhook($request));

        return response()->json($webhook, Response::HTTP_CREATED);
    }

    public function show(Webhook $webhook): JsonResponse
    {
        return response()->json(
            $webhook->load(['deliveries' => fn ($query) => $query->latest()->limit(20)])
        );
    }

    public function update(Request $request, Webhook $webhook): JsonResponse
    {
        $webhook->update($this->validateWebhook($request, partial: true));

        return response()->json($webhook->refresh());
    }

    public function destroy(Webhook $webhook): Response
    {
        $webhook->delete();

        return response()->noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private function validateWebhook(Request $request, bool $partial = false): array
    {
        $required = $partial ? 'sometimes' : 'required';

        $validated = $request->validate([
            'url' => [$required, 'url', 'max:2048'],
            'secret' => [$required, 'string', 'min:16', 'max:255'],
            'events' => [$required, 'array', 'min:1'],
            'events.*' => ['string', 'max:255'],
            'active' => ['sometimes', 'boolean'],
        ]);

        if (! array_key_exists('active', $validated) && ! $partial) {
            $validated['active'] = true;
        }

        return $validated;
    }
}
