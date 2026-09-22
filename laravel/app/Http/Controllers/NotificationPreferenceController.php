<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class NotificationPreferenceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $preferences = NotificationPreference::where('user_id', $request->user()->id)
            ->orderBy('event_type')
            ->orderBy('channel')
            ->get();

        return response()->json($preferences);
    }

    public function update(Request $request, NotificationPreference $notificationPreference): JsonResponse
    {
        if ($notificationPreference->user_id !== $request->user()->id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $validated = $request->validate([
            'enabled' => 'required|boolean',
        ]);

        $notificationPreference->update($validated);

        return response()->json($notificationPreference);
    }

    public function bulkUpdate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'preferences' => 'required|array',
            'preferences.*.id' => 'required|integer|exists:notification_preferences,id',
            'preferences.*.enabled' => 'required|boolean',
        ]);

        $userId = $request->user()->id;
        $updatedPreferences = [];

        foreach ($validated['preferences'] as $pref) {
            $preference = NotificationPreference::where('id', $pref['id'])
                ->where('user_id', $userId)
                ->first();

            if ($preference) {
                $preference->update(['enabled' => $pref['enabled']]);
                $updatedPreferences[] = $preference;
            }
        }

        return response()->json($updatedPreferences);
    }
}