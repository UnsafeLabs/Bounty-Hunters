<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationPreferenceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $userId = $this->resolveUserId($request);

        return response()->json(
            NotificationPreference::query()
                ->where('user_id', $userId)
                ->orderBy('event_type')
                ->orderBy('channel')
                ->get()
        );
    }

    public function update(Request $request, NotificationPreference $preference): JsonResponse
    {
        $this->ensurePreferenceBelongsToRequester($request, $preference);

        $validated = $request->validate([
            'enabled' => ['required', 'boolean'],
        ]);

        $preference->update($validated);

        return response()->json($preference->refresh());
    }

    public function bulkUpdate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'preferences' => ['required', 'array', 'min:1'],
            'preferences.*.id' => ['required', 'integer', 'exists:notification_preferences,id'],
            'preferences.*.enabled' => ['required', 'boolean'],
        ]);

        $userId = $this->resolveUserId($request);
        $requestedIds = collect($validated['preferences'])->pluck('id')->all();
        $ownedCount = NotificationPreference::query()
            ->where('user_id', $userId)
            ->whereIn('id', $requestedIds)
            ->count();

        abort_unless($ownedCount === count($requestedIds), 404);

        $updated = collect($validated['preferences'])->map(function (array $item) {
            $preference = NotificationPreference::query()->findOrFail($item['id']);
            $preference->update(['enabled' => $item['enabled']]);

            return $preference->refresh();
        });

        return response()->json($updated->values());
    }

    private function resolveUserId(Request $request): int
    {
        return (int) ($request->user()?->id ?? $request->integer('user_id'));
    }

    private function ensurePreferenceBelongsToRequester(Request $request, NotificationPreference $preference): void
    {
        abort_unless($preference->user_id === $this->resolveUserId($request), 404);
    }
}
