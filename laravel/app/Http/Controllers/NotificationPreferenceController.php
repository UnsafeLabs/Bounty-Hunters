<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationPreferenceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $preferences = NotificationPreference::where('user_id', $request->user()?->id)
            ->orderBy('event_type')
            ->orderBy('channel')
            ->get();

        return response()->json($preferences);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $preference = NotificationPreference::where('user_id', $request->user()?->id)
            ->findOrFail($id);

        $data = $request->validate([
            'enabled' => 'required|boolean',
        ]);

        $preference->update($data);

        return response()->json($preference);
    }

    public function bulkUpdate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'preferences' => 'required|array',
            'preferences.*.id' => 'required|integer|exists:notification_preferences,id',
            'preferences.*.enabled' => 'required|boolean',
        ]);

        $userId = $request->user()?->id;
        $updated = [];

        foreach ($data['preferences'] as $item) {
            $preference = NotificationPreference::where('user_id', $userId)
                ->where('id', $item['id'])
                ->first();

            if ($preference) {
                $preference->update(['enabled' => $item['enabled']]);
                $updated[] = $preference;
            }
        }

        return response()->json($updated);
    }
}
