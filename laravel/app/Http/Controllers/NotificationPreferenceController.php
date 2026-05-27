<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\Request;

class NotificationPreferenceController extends Controller
{
    public function index(Request $request)
    {
        $preferences = $request->user()
            ->notificationPreferences()
            ->get();

        return response()->json($preferences);
    }

    public function update(Request $request, NotificationPreference $preference)
    {
        // Ensure user can only update their own preferences
        if ($request->user()->id !== $preference->user_id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $request->validate([
            'enabled' => 'boolean'
        ]);

        $preference->update($request->only('enabled'));

        return response()->json($preference);
    }

    public function bulkUpdate(Request $request)
    {
        $request->validate([
            'preferences' => 'required|array',
            'preferences.*.id' => 'required|exists:notification_preferences,id',
            'preferences.*.enabled' => 'required|boolean'
        ]);

        $updated = [];
        foreach ($request->preferences as $prefData) {
            $preference = NotificationPreference::find($prefData['id']);
            
            // Ensure user can only update their own preferences
            if ($request->user()->id === $preference->user_id) {
                $preference->update(['enabled' => $prefData['enabled']]);
                $updated[] = $preference;
            }
        }

        return response()->json($updated);
    }
}