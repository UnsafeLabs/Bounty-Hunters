<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationPreferenceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $prefs = NotificationPreference::query()
            ->where('user_id', $user->id)
            ->orderBy('event_type')
            ->orderBy('channel')
            ->get();

        return response()->json(['data' => $prefs]);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        $pref = NotificationPreference::query()
            ->where('user_id', $user->id)
            ->findOrFail($id);

        $validated = $request->validate([
            'enabled' => ['required', 'boolean'],
        ]);

        $pref->enabled = $validated['enabled'];
        $pref->save();

        return response()->json([
            'data' => $pref,
            'message' => 'Preference updated',
        ]);
    }

    public function bulkUpdate(Request $request): JsonResponse
    {
        $user = $request->user();
        $validated = $request->validate([
            'preferences' => ['required', 'array', 'min:1'],
            'preferences.*.id' => ['required', 'integer'],
            'preferences.*.enabled' => ['required', 'boolean'],
        ]);

        $updated = [];
        foreach ($validated['preferences'] as $row) {
            $pref = NotificationPreference::query()
                ->where('user_id', $user->id)
                ->find($row['id']);
            if (! $pref) {
                continue;
            }
            $pref->enabled = $row['enabled'];
            $pref->save();
            $updated[] = $pref;
        }

        return response()->json([
            'data' => $updated,
            'message' => 'Preferences updated',
        ]);
    }
}
