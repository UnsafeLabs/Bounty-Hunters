<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationPreferenceController extends Controller
{
    /**
     * List notification preferences for the authenticated user.
     */
    public function index(Request $request): JsonResponse
    {
        $preferences = $request->user()
            ->notificationPreferences()
            ->orderBy('event_type')
            ->orderBy('channel')
            ->get();

        return response()->json([
            'data' => $preferences,
        ]);
    }

    /**
     * Toggle a single notification preference.
     */
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

    /**
     * Toggle several notification preferences in one request.
     */
    public function bulkUpdate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'preferences' => ['required', 'array'],
            'preferences.*.id' => ['required', 'integer'],
            'preferences.*.enabled' => ['required', 'boolean'],
        ]);

        $preferencesById = $request->user()
            ->notificationPreferences()
            ->whereIn('id', collect($validated['preferences'])->pluck('id'))
            ->get()
            ->keyBy('id');

        foreach ($validated['preferences'] as $preferenceData) {
            $preference = $preferencesById->get($preferenceData['id']);

            if ($preference === null) {
                continue;
            }

            $preference->update([
                'enabled' => $preferenceData['enabled'],
            ]);
        }

        return response()->json([
            'data' => $request->user()
                ->notificationPreferences()
                ->orderBy('event_type')
                ->orderBy('channel')
                ->get(),
        ]);
    }
}
