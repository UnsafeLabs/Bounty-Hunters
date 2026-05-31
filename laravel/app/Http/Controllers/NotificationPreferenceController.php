<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationPreferenceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $request->user()
                ->notificationPreferences()
                ->orderBy('event_type')
                ->orderBy('channel')
                ->get(),
        ]);
    }

    public function update(Request $request, NotificationPreference $preference): JsonResponse
    {
        abort_unless($preference->user_id === $request->user()->id, 404);

        $validated = $request->validate([
            'enabled' => ['required', 'boolean'],
        ]);

        $preference->update($validated);

        return response()->json([
            'data' => $preference->refresh(),
        ]);
    }

    public function bulkUpdate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'preferences' => ['required', 'array', 'min:1'],
            'preferences.*.id' => ['required', 'integer'],
            'preferences.*.enabled' => ['required', 'boolean'],
        ]);

        $updates = collect($validated['preferences'])->keyBy('id');
        $preferences = $request->user()
            ->notificationPreferences()
            ->whereIn('id', $updates->keys()->all())
            ->get();

        abort_unless($preferences->count() === $updates->count(), 404);

        $preferences->each(function (NotificationPreference $preference) use ($updates): void {
            $preference->update([
                'enabled' => $updates[$preference->id]['enabled'],
            ]);
        });

        return response()->json([
            'data' => $preferences->fresh()->sortBy('id')->values(),
        ]);
    }
}
