<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

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
}
