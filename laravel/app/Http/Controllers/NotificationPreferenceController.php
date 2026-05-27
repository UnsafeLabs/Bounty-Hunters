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
        $preferences = NotificationPreference::where('user_id', Auth::id())
            ->orderBy('event_type')
            ->orderBy('channel')
            ->get();

        return response()->json([
            'data' => $preferences,
        ]);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $preference = NotificationPreference::where('user_id', Auth::id())
            ->findOrFail($id);

        $validated = $request->validate([
            'enabled' => ['required', 'boolean'],
        ]);

        $preference->update($validated);

        return response()->json([
            'data' => $preference,
        ]);
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

        foreach ($validated['preferences'] as $item) {
            $preference = NotificationPreference::where('user_id', $userId)
                ->where('id', $item['id'])
                ->first();

            if ($preference) {
                $preference->update(['enabled' => $item['enabled']]);
                $updated[] = $preference;
            }
        }

        return response()->json([
            'data' => $updated,
        ]);
    }
}