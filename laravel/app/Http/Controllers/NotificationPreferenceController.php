<?php

namespace App\Http\Controllers;

use App\Models\NotificationPreference;
use Illuminate\Http\Request;

class NotificationPreferenceController extends Controller
{
    public function index(Request $request)
    {
        $preferences = $request->user()->notificationPreferences;
        return response()->json($preferences);
    }

    public function update(Request $request, NotificationPreference $preference)
    {
        $this->authorize('update', $preference);
        
        $validated = $request->validate([
            'enabled' => 'boolean'
        ]);

        $preference->update($validated);

        return response()->json($preference);
    }

    public function bulkUpdate(Request $request)
    {
        $validated = $request->validate([
            'preferences' => 'required|array',
            'preferences.*.id' => 'required|exists:notification_preferences,id',
            'preferences.*.enabled' => 'required|boolean'
        ]);

        foreach ($validated['preferences'] as $prefData) {
            $preference = NotificationPreference::find($prefData['id']);
            if ($preference && $preference->user_id === $request->user()->id) {
                $preference->update(['enabled' => $prefData['enabled']]);
            }
        }

        return response()->json(['message' => 'Preferences updated successfully']);
    }
}