<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;

class NotificationPreferenceController extends Controller
{
    public function index(): JsonResponse
    {
        $preferences = NotificationPreference::forUser(Auth::id())
            ->get()
            ->groupBy('event_type')
            ->map(function ($group) {
                return $group->mapWithKeys(function ($item) {
                    return [$item->channel => $item->enabled];
                });
            });

        return response()->json($preferences);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'enabled' => ['required', 'boolean'],
        ]);

        $preference = NotificationPreference::forUser(Auth::id())
            ->findOrFail($id);

        $preference->update(['enabled' => $validated['enabled']]);

        return response()->json($preference);
    }

    public function bulkUpdate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'preferences' => ['required', 'array'],
            'preferences.*.id' => ['required', 'integer', 'exists:notification_preferences,id'],
            'preferences.*.enabled' => ['required', 'boolean'],
        ]);

        $userId = Auth::id();
        $updated = [];

        foreach ($validated['preferences'] as $prefData) {
            $preference = NotificationPreference::forUser($userId)
                ->where('id', $prefData['id'])
                ->first();

            if ($preference) {
                $preference->update(['enabled' => $prefData['enabled']]);
                $updated[] = $preference;
            }
        }

        return response()->json([
            'message' => 'Preferences updated successfully',
            'updated' => count($updated),
            'preferences' => $updated,
        ]);
    }
}